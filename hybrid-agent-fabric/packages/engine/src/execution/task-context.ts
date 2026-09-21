/**
 * TaskContext — everything one task knows, owned by that task alone.
 *
 * The problem this solves: `engine.cognitiveState` is a single instance shared
 * by every task in the process. `MetaController` calls `setMode("planning")`,
 * `UnifiedCognitiveLoop` keeps `eventsEmitted` and `recoveryAttempts` as
 * class-level fields. Two concurrent tasks therefore overwrite each other's
 * mode, and a recovery in task B increments a counter task A will report.
 *
 * The fix is ownership, not locking. State that belongs to one execution lives
 * in a value created at the start of that execution and discarded at the end.
 *
 *     Engine
 *      └── Tenant
 *           └── Session
 *                └── Task
 *                     └── CognitiveContext
 */

import { randomUUID } from "node:crypto";

import type { ExecutionOutcome, ExecutionStatus } from "./execution-status.js";

/** Cognitive phase of the main loop. */
export type CognitivePhase =
  | "observing"
  | "understanding"
  | "recalling"
  | "planning"
  | "acting"
  | "verifying"
  | "learning"
  | "recovering"
  | "idle";

/** Spend limits for one task. Absent means unlimited, which is rarely right. */
export interface TaskBudget {
  readonly tokens?: number | undefined;
  readonly timeMs?: number | undefined;
  readonly toolCalls?: number | undefined;
  readonly costUsd?: number | undefined;
  /** How many recovery attempts before giving up. Prevents infinite loops. */
  readonly maxRecoveryAttempts?: number | undefined;
}

/** What has actually been spent. */
export interface BudgetSpend {
  tokens: number;
  timeMs: number;
  toolCalls: number;
  costUsd: number;
  recoveryAttempts: number;
}

export interface Observation {
  readonly at: string;
  readonly source: string;
  readonly summary: string;
  readonly detail?: unknown;
}

export interface RecordedFailure {
  readonly at: string;
  readonly phase: CognitivePhase;
  readonly message: string;
  /** Set once the failure has been classified by the taxonomy. */
  readonly category?: string | undefined;
  readonly recoverable?: boolean | undefined;
}

/**
 * One step of a task plan.
 *
 * Named `TaskPlanStep` rather than `PlanStep` because `aurora/planning-service`
 * already exports a different `PlanStep` with its own lifecycle vocabulary
 * (`pending`/`ready`/`in-progress`/...). Two types with one name would have
 * forced every reader to work out which was meant.
 *
 * Steps carry `dependencies` because the planner already computes them —
 * `PlanningEngine.decomposeGoal` returns a real DAG — and the execution loop
 * used to throw that structure away, flattening every plan to a list of
 * strings. A plan without edges cannot tell you whether step 4 was skipped
 * because it failed or because step 2 never produced what it needed.
 */
export interface TaskPlanStep {
  /** Stable within a plan; `dependencies` refer to these. */
  readonly id: string;
  readonly description: string;
  /**
   * Ids of steps that must reach a successful status first.
   *
   * Empty means the step is immediately eligible.
   */
  readonly dependencies: readonly string[];
  /**
   * Starts as `not_implemented` — "no execution has been attempted".
   *
   * Deliberately not `skipped`: `skipped` is a decision, and a step nobody has
   * looked at yet has not been decided about. The two used to be conflated,
   * which made every plan in every report read as if it had been considered
   * and passed over.
   */
  status: ExecutionStatus;
  /** Why the step ended in its status. Absent while untouched. */
  detail?: string | undefined;
}

export interface TaskPlan {
  readonly steps: TaskPlanStep[];
}

export interface TraceEntry {
  readonly at: string;
  readonly phase: CognitivePhase;
  readonly event: string;
  readonly detail?: unknown;
  /** Links this entry to the event that caused it. */
  readonly causationId?: string | undefined;
}

export interface TaskContextInit {
  readonly tenantId: string;
  readonly goal: string;
  readonly taskId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly workspace?: string | undefined;
  readonly constraints?: readonly string[] | undefined;
  readonly budget?: TaskBudget | undefined;
  /** Ties this task to a wider trace (an eval run, a user conversation). */
  readonly correlationId?: string | undefined;
}

/**
 * One task's complete, isolated state.
 *
 * Mutable by design — a task accumulates observations as it runs — but every
 * mutation is scoped to this instance, so concurrent tasks cannot interfere.
 */
export class TaskContext {
  readonly taskId: string;
  readonly tenantId: string;
  readonly goal: string;
  readonly constraints: readonly string[];
  readonly budget: TaskBudget;
  readonly correlationId: string;
  readonly traceId: string;
  readonly startedAt: number;

  /** Assigned when the agent session is created. */
  sessionId: string | undefined;
  workspace: string | undefined;

  private phaseValue: CognitivePhase = "observing";
  private readonly phaseHistoryValue: Array<{ at: number; phase: CognitivePhase; reason: string }> = [];

  readonly memories: string[] = [];
  readonly hypotheses: Array<{ statement: string; probability: number; evidence: string[] }> = [];
  readonly observations: Observation[] = [];
  readonly failures: RecordedFailure[] = [];
  readonly trace: TraceEntry[] = [];
  readonly outcomes: ExecutionOutcome[] = [];

  plan: TaskPlan | undefined;

  /**
   * Which attempt is running, 1-based.
   *
   * The agent needs this: retrying a task without telling the agent it is a
   * retry invites it to repeat the same failing move.
   */
  attempt = 1;

  /**
   * Why earlier attempts failed, in the agent's own terms.
   *
   * Kept separate from `failures` (which holds the loop's classification)
   * because this is briefing material, not bookkeeping.
   */
  readonly priorFailures: string[] = [];

  /**
   * What the next attempt must do differently, set by the recovery decision.
   *
   * `undefined` on the first attempt, and whenever the chosen strategy is a
   * plain retry — there is nothing to change, so saying something would be
   * noise.
   */
  recoveryDirective: string | undefined = undefined;

  /**
   * The model route this attempt runs on.
   *
   * Recovery escalates it on `change_model`, so a reasoning failure is not
   * retried on the model that just produced it.
   */
  /**
   * Tools that failed in earlier attempts and should not be reached for again.
   *
   * Accumulates: a tool that broke on attempt 1 is still a bad bet on
   * attempt 3. Empty on the first attempt, and left empty when the failing
   * tool could not be identified — guessing one would send the agent away
   * from a tool that was working.
   */
  readonly avoidTools: string[] = [];

  modelRoute: string | undefined = undefined;

  /** Routes still available to escalate to, in order. Consumed as they are used. */
  fallbackModels: string[] = [];

  /**
   * Move to the next fallback route.
   *
   * Returns the new route, or `undefined` when the list is exhausted — the
   * caller must report that honestly rather than re-running the same model
   * while claiming a switch happened.
   */
  escalateModel(): string | undefined {
    const next = this.fallbackModels.shift();
    if (next === undefined) return undefined;
    this.modelRoute = next;
    return next;
  }

  readonly spend: BudgetSpend = {
    tokens: 0,
    timeMs: 0,
    toolCalls: 0,
    costUsd: 0,
    recoveryAttempts: 0,
  };

  constructor(init: TaskContextInit) {
    if (!init.tenantId?.trim()) throw new Error("TaskContext requires a tenantId.");
    if (!init.goal?.trim()) throw new Error("TaskContext requires a goal.");

    this.taskId = init.taskId ?? `task-${randomUUID()}`;
    this.tenantId = init.tenantId;
    this.goal = init.goal;
    this.constraints = init.constraints ?? [];
    this.budget = init.budget ?? {};
    this.correlationId = init.correlationId ?? this.taskId;
    this.traceId = `trace-${randomUUID()}`;
    this.startedAt = Date.now();
    this.sessionId = init.sessionId;
    this.workspace = init.workspace;

    this.phaseHistoryValue.push({ at: this.startedAt, phase: "observing", reason: "Task created" });
  }

  get phase(): CognitivePhase {
    return this.phaseValue;
  }

  get phaseHistory(): ReadonlyArray<{ at: number; phase: CognitivePhase; reason: string }> {
    return this.phaseHistoryValue;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  enterPhase(phase: CognitivePhase, reason: string): void {
    this.phaseValue = phase;
    this.phaseHistoryValue.push({ at: Date.now(), phase, reason });
    this.record(phase, "phase.entered", { reason });
  }

  record(phase: CognitivePhase, event: string, detail?: unknown, causationId?: string): void {
    this.trace.push({
      at: new Date().toISOString(),
      phase,
      event,
      detail,
      causationId,
    });
  }

  observe(source: string, summary: string, detail?: unknown): void {
    this.observations.push({ at: new Date().toISOString(), source, summary, detail });
  }

  fail(phase: CognitivePhase, message: string, extra: { category?: string; recoverable?: boolean } = {}): void {
    this.failures.push({
      at: new Date().toISOString(),
      phase,
      message,
      category: extra.category,
      recoverable: extra.recoverable,
    });
  }

  addOutcome(item: ExecutionOutcome): void {
    this.outcomes.push(item);
  }

  spendTokens(count: number): void {
    this.spend.tokens += count;
  }

  spendToolCall(count = 1): void {
    this.spend.toolCalls += count;
  }

  spendCost(usd: number): void {
    this.spend.costUsd += usd;
  }

  /**
   * Has this task run out of room?
   *
   * Returns the reason rather than a boolean so callers can report *which*
   * limit stopped them, which matters when diagnosing a truncated run.
   */
  budgetExceeded(): string | undefined {
    const { budget, spend } = this;
    if (budget.tokens !== undefined && spend.tokens > budget.tokens) {
      return `token budget exhausted (${spend.tokens}/${budget.tokens})`;
    }
    if (budget.toolCalls !== undefined && spend.toolCalls > budget.toolCalls) {
      return `tool-call budget exhausted (${spend.toolCalls}/${budget.toolCalls})`;
    }
    if (budget.costUsd !== undefined && spend.costUsd > budget.costUsd) {
      return `cost budget exhausted ($${spend.costUsd.toFixed(4)}/$${budget.costUsd.toFixed(4)})`;
    }
    if (budget.timeMs !== undefined && this.elapsedMs > budget.timeMs) {
      return `time budget exhausted (${this.elapsedMs}ms/${budget.timeMs}ms)`;
    }
    const maxRecovery = budget.maxRecoveryAttempts ?? 3;
    if (spend.recoveryAttempts > maxRecovery) {
      return `recovery attempts exhausted (${spend.recoveryAttempts}/${maxRecovery})`;
    }
    return undefined;
  }

  /** Serialisable view, for trajectories and crash recovery. */
  snapshot(): Record<string, unknown> {
    return {
      taskId: this.taskId,
      tenantId: this.tenantId,
      sessionId: this.sessionId,
      goal: this.goal,
      workspace: this.workspace,
      phase: this.phaseValue,
      correlationId: this.correlationId,
      traceId: this.traceId,
      elapsedMs: this.elapsedMs,
      spend: { ...this.spend },
      counts: {
        memories: this.memories.length,
        hypotheses: this.hypotheses.length,
        observations: this.observations.length,
        failures: this.failures.length,
        traceEntries: this.trace.length,
        outcomes: this.outcomes.length,
      },
    };
  }
}
