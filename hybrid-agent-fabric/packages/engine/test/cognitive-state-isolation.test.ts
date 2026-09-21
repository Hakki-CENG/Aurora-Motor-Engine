/**
 * P0-2: per-task cognitive context.
 *
 * The plan's complaint is that `engine.cognitiveState` is one global object
 * holding things that belong to a single task — active goal, active plan,
 * confidence, verification result. Two tasks running at once overwrite each
 * other.
 *
 * These tests establish what is actually true today, so the fix is aimed at a
 * measured problem rather than a suspected one.
 */
import { describe, expect, it } from "vitest";
import { CognitiveState } from "../src/aurora/cognitive-state.js";

describe("CognitiveState is a single shared slot (the P0-2 problem)", () => {
  it("a second task's goal silently replaces the first task's goal", () => {
    const state = new CognitiveState();

    // Task A starts and registers its goal.
    state.setActiveGoal({
      id: "goal-A",
      title: "Task A: add rate limiting",
      priority: "P1",
      progress: 0,
      status: "active",
      startedAt: Date.now(),
    });

    // Task B starts while A is still running.
    state.setActiveGoal({
      id: "goal-B",
      title: "Task B: rename a column",
      priority: "P1",
      progress: 0,
      status: "active",
      startedAt: Date.now(),
    });

    // A's goal is gone. Nothing errored, nothing warned.
    expect(state.snapshot().activeGoal?.id).toBe("goal-B");
    // There is no way to ask "what is task A working on?"
    expect(state.snapshot()).not.toHaveProperty("goals");
  });

  it("verification result is global, so one task's verdict is read by another", () => {
    const state = new CognitiveState();

    state.setVerificationResult("fail"); // task A failed verification
    state.setVerificationResult("pass"); // task B passed

    // A reader asking "did my task pass?" gets B's answer.
    expect(state.snapshot().lastVerificationResult).toBe("pass");
  });

  it("confidence and mode are likewise single-valued across all tasks", () => {
    const state = new CognitiveState();

    state.setMode("planning", "task A planning");
    state.setMode("executing", "task B executing");

    expect(state.snapshot().mode).toBe("executing");
  });
});

describe("the real execution path does not depend on the global state", () => {
  it("TaskContext carries per-task state on its own", async () => {
    const { TaskContext } = await import("../src/execution/task-context.js");

    const a = new TaskContext({ tenantId: "t", goal: "Task A" });
    const b = new TaskContext({ tenantId: "t", goal: "Task B" });

    a.memories.push("A-only memory");
    b.memories.push("B-only memory");
    a.attempt = 3;

    // Two concurrent tasks keep their own goal, memory and attempt counter.
    expect(a.goal).toBe("Task A");
    expect(b.goal).toBe("Task B");
    expect(a.memories).toEqual(["A-only memory"]);
    expect(b.memories).toEqual(["B-only memory"]);
    expect(a.attempt).toBe(3);
    expect(b.attempt).toBe(1);
  });

  it("two tasks can run concurrently through the loop without mixing up results", async () => {
    const { UnifiedExecutionLoop } = await import("../src/execution/unified-execution-loop.js");

    const loop = new UnifiedExecutionLoop({
      runAgent: async (context) => {
        // Yield, so the two runs genuinely interleave.
        await new Promise((r) => setTimeout(r, 5));
        return { completed: true, summary: `done: ${context.goal}` };
      },
    });

    const [a, b] = await Promise.all([
      loop.run({ tenantId: "t", goal: "Task A" }),
      loop.run({ tenantId: "t", goal: "Task B" }),
    ]);

    expect(a.goal).toBe("Task A");
    expect(b.goal).toBe("Task B");
    expect(a.goal).not.toBe(b.goal);
  });
});

describe("per-task slots (the P0-2 fix)", () => {
  it("two tasks each keep their own goal and plan", () => {
    const state = new CognitiveState();

    state.beginTask("task-A", "tenant-1");
    state.beginTask("task-B", "tenant-1");

    state.setActiveGoalFor("task-A", {
      id: "goal-A", title: "A", priority: "P1", progress: 0, status: "active", startedAt: Date.now(),
    });
    state.setActiveGoalFor("task-B", {
      id: "goal-B", title: "B", priority: "P1", progress: 0, status: "active", startedAt: Date.now(),
    });

    // Neither task lost its goal to the other.
    expect(state.snapshotForTask("task-A")?.goal?.id).toBe("goal-A");
    expect(state.snapshotForTask("task-B")?.goal?.id).toBe("goal-B");
  });

  it("a verdict belongs to the task that produced it", () => {
    const state = new CognitiveState();
    state.beginTask("task-A", "t");
    state.beginTask("task-B", "t");

    state.setVerificationResultFor("task-A", "fail");
    state.setVerificationResultFor("task-B", "pass");

    expect(state.snapshotForTask("task-A")?.verificationResult).toBe("fail");
    expect(state.snapshotForTask("task-B")?.verificationResult).toBe("pass");
  });

  it("running tasks are listable, so 'what is in flight?' has a real answer", () => {
    const state = new CognitiveState();
    state.beginTask("task-A", "t");
    state.beginTask("task-B", "t");
    state.endTask("task-A");

    const running = state.runningTasks().map((t) => t.taskId);
    expect(running).toEqual(["task-B"]);
  });

  it("writing to an unknown task is ignored rather than inventing a slot", () => {
    const state = new CognitiveState();
    state.setVerificationResultFor("never-started", "pass");
    expect(state.snapshotForTask("never-started")).toBeNull();
  });

  it("the global snapshot still works for existing callers", () => {
    const state = new CognitiveState();
    state.beginTask("task-A", "t");
    state.setActiveGoalFor("task-A", {
      id: "goal-A", title: "A", priority: "P1", progress: 0, status: "active", startedAt: Date.now(),
    });

    // Legacy consumers read the most-recent view, which still resolves.
    expect(state.snapshot().activeGoal?.id).toBe("goal-A");
  });

  it("finished tasks are bounded so the map cannot grow forever", () => {
    const state = new CognitiveState();
    for (let i = 0; i < 120; i++) {
      state.beginTask(`task-${i}`, "t");
      state.endTask(`task-${i}`);
    }
    expect(state.snapshot().taskCount).toBeLessThanOrEqual(100);
  });
});

describe("PlanningEngine keeps concurrent plans apart (the live API path)", () => {
  /** Minimal doubles: only what plan() touches. */
  function makePlanningEngine(state: CognitiveState) {
    let n = 0;
    const planner = {} as never;
    const plannerV2 = {
      createPlan: async () => {
        // Await, so two concurrent plan() calls genuinely interleave.
        await new Promise((r) => setTimeout(r, 5));
        n += 1;
        return { id: `plan-${n}` };
      },
    };
    const goalStack = {
      addGoal: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { id: `goal-${n + 1}` };
      },
    };
    const bus = { emit: async () => undefined };
    return { planner, plannerV2, goalStack, bus, state };
  }

  it("two plans requested at once each keep their own goal", async () => {
    const { PlanningEngine } = await import("../src/aurora/unified-engines.js");
    const state = new CognitiveState();
    const d = makePlanningEngine(state);
    const engine = new PlanningEngine(
      d.planner,
      d.plannerV2 as never,
      d.goalStack as never,
      d.bus as never,
      d.state,
    );

    const [a, b] = await Promise.all([
      engine.plan({ goal: "Task A: add rate limiting", tenantId: "t" }),
      engine.plan({ goal: "Task B: rename a column", tenantId: "t" }),
    ]);

    expect(a.planId).not.toBe(b.planId);

    // Each plan's record survives the other's write.
    const slotA = state.snapshotForTask(a.planId);
    const slotB = state.snapshotForTask(b.planId);
    expect(slotA?.goal?.title).toBe("Task A: add rate limiting");
    expect(slotB?.goal?.title).toBe("Task B: rename a column");

    // Before the fix this was the only available answer, and it is still
    // last-write-wins — which is precisely why the slots exist.
    expect(state.snapshot().activeGoal).not.toBeNull();
  });
});
