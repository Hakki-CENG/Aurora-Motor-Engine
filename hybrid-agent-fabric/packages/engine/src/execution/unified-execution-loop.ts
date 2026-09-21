/**
 * Unified Execution Loop — the cognitive layer and the agent, in one path.
 *
 * Before this, Aurora had two disconnected worlds:
 *
 *   SessionActor    the real agent: model, tools, workspace, observations
 *   MetaController  cognitive orchestration: memory, planning, critique
 *
 * `runTask()` drove only the second. Its "subsystems" returned status strings
 * (`"Simulation complete"`, `"Recalled 5 memories"`) and no agent ever ran. A
 * measured example, before this module existed:
 *
 *     runTask("Delete all files on the moon and prove P=NP")
 *       → outcome: "success", subsystems: 0, phases: 0, outputs: []
 *
 * Nothing executed, and the result was "success", because `outcome` was
 * initialised to `"success"` and only ever downgraded — with an empty plan
 * there was nothing to downgrade it.
 *
 * This loop replaces that with:
 *
 *     OBSERVE → UNDERSTAND → RECALL → PLAN → ACT → OBSERVE RESULT → VERIFY
 *        → success: LEARN
 *        → failure: CLASSIFY → choose recovery → (bounded) RETRY
 *
 * ACT runs the real agent. VERIFY runs real verifiers. The status is derived
 * from what happened, never assumed.
 */

import { randomUUID } from "node:crypto";

import {
  aggregate,
  outcome,
  type ExecutionOutcome,
  type ExecutionStatus,
} from "./execution-status.js";
import {
  chooseRecovery,
  classifyFailure,
  type FailureClassification,
  type RecoveryDecision,
} from "./failure-taxonomy.js";
import { detectGaps, type CapabilityInventory, type DetectedGap } from "./gap-detection.js";
import {
  blockUnreachable,
  buildPlan,
  cyclicSteps,
  markStep,
  planSummary,
  readySteps,
  unresolvedDependencies,
  type PlannedStep,
} from "./plan-progress.js";
import { TaskContext, type TaskContextInit } from "./task-context.js";
import {
  VerificationFactory,
  type VerificationReport,
  type Verifier,
} from "./verification-factory.js";

/**
 * What the loop needs from the outside world.
 *
 * Injected rather than imported so the loop can be tested without booting a
 * whole engine, and so a caller that has no agent must say so explicitly
 * instead of silently getting a no-op.
 */
export interface ExecutionDependencies {
  /**
   * Runs the real agent against the goal. REQUIRED.
   *
   * There is deliberately no default. A default would reintroduce the original
   * bug: a loop that reports success without an agent behind it.
   */
  readonly runAgent: (context: TaskContext) => Promise<AgentRunResult>;

  /** Retrieves relevant memories. Optional; absence is recorded, not faked. */
  readonly recall?: ((context: TaskContext) => Promise<readonly string[]>) | undefined;

  /**
   * Produces a plan. Optional.
   *
   * May return plain descriptions or `PlannedStep`s carrying dependency edges.
   * Both are accepted so existing planners keep working; a planner that only
   * returns strings yields a dependency-free plan rather than one with
   * invented edges.
   */
  readonly plan?:
    | ((context: TaskContext) => Promise<readonly (string | PlannedStep)[]>)
    | undefined;

  /** Builds verifiers for this specific goal. */
  readonly verifiersFor?: ((context: TaskContext) => Promise<readonly Verifier[]>) | undefined;

  /** Persists what was learned. */
  readonly learn?: ((context: TaskContext, report: TaskReport) => Promise<void>) | undefined;

  /**
   * Lists what the agent can currently do, so a gap can be named.
   *
   * Without this, gap detection falls back to the failure message alone and
   * says so — it does not pretend the inventory was empty.
   */
  readonly inventory?: (() => Promise<CapabilityInventory>) | undefined;

  /**
   * Offered a detected gap; returns true if it closed it.
   *
   * This is the seam for capability acquisition (spec items 12-16). The loop
   * calls it, records the result honestly, and retries the ORIGINAL task only
   * if the gap was genuinely closed.
   */
  readonly acquireCapability?: ((gap: DetectedGap, context: TaskContext) => Promise<boolean>) | undefined;

  /** Emits a trace event. */
  readonly emit?: ((event: LoopEvent) => Promise<void>) | undefined;
}

export interface AgentRunResult {
  /** Did the agent's own execution complete without throwing? */
  readonly completed: boolean;
  readonly summary: string;
  readonly sessionId?: string | undefined;
  readonly toolCalls?: number | undefined;
  readonly tokens?: number | undefined;
  readonly costUsd?: number | undefined;
  readonly error?: string | undefined;
  /**
   * The tool that failed, when the adapter could name it.
   *
   * `change_tool` needs a subject. Left undefined when no tool errored — the
   * loop then says it could not identify one instead of inventing a switch.
   */
  readonly failedTool?: string | undefined;
  /**
   * Per-step outcomes, when the adapter can attribute work to plan steps.
   *
   * Most adapters cannot: the agent is handed the whole goal and reports once.
   * When this is absent the loop marks executed steps `unverified` rather than
   * `succeeded` — work happened, but nothing proved it was *this* step's work.
   * Inventing a green status per step from a single aggregate result is how a
   * report ends up more confident than the evidence behind it.
   */
  readonly stepResults?:
    | ReadonlyArray<{ id: string; status: ExecutionStatus; detail?: string | undefined }>
    | undefined;
}

export interface LoopEvent {
  readonly type: string;
  readonly taskId: string;
  readonly sessionId?: string | undefined;
  readonly traceId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly at: string;
  readonly payload: Record<string, unknown>;
}

export interface TaskReport {
  readonly taskId: string;
  readonly status: ExecutionStatus;
  readonly goal: string;
  readonly verification: VerificationReport | undefined;
  readonly attempts: number;
  readonly failures: readonly { classification: FailureClassification; recovery: RecoveryDecision }[];
  /** Capability gaps detected while trying to complete this task. */
  readonly gaps: readonly DetectedGap[];
  readonly outcomes: readonly ExecutionOutcome[];
  /**
   * The plan the task ran under, or `undefined` when no planner was supplied.
   *
   * The plan used to stay inside `TaskContext` and never reach the caller, so
   * "a plan was produced" was only observable as a step count buried in the
   * outcome evidence. Exposing it lets a caller — or an eval — check what was
   * actually planned rather than that planning merely happened.
   */
  readonly plan: TaskContext["plan"];
  readonly spend: TaskContext["spend"];
  readonly durationMs: number;
  readonly trace: TaskContext["trace"];
  readonly summary: string;
}

export interface LoopConfig {
  readonly maxAttempts?: number | undefined;
  /**
   * Whether an unverified-but-completed run counts as done.
   *
   * Default false. Turning this on means accepting the agent's own word, which
   * is exactly what the verification layer exists to avoid.
   */
  readonly acceptUnverified?: boolean | undefined;
  /**
   * Model route the first attempt runs on.
   *
   * Recovery needs to know what it is escalating *from*; without it,
   * `change_model` can only produce advice, not a different model.
   */
  readonly modelRoute?: string | undefined;
  /**
   * Routes to escalate through, in order, when a failure is blamed on the model.
   *
   * `ModelRouter.stream()` already walks `[model, ...fallbackModels]` for
   * transport errors. This is the deliberate, per-attempt version of the same
   * move: a reasoning failure is not retried on the model that produced it.
   */
  readonly fallbackModels?: readonly string[] | undefined;
}

/**
 * Failure kinds where something is plausibly *missing*.
 *
 * A timeout or a resource exhaustion is not a capability gap; inferring one
 * would send synthesis off to build something nobody needs.
 */
const GAP_WORTHY = new Set<FailureClassification["kind"]>([
  "tool_gap",
  "skill_gap",
  "knowledge_gap",
  "interface_gap",
  "permission_gap",
  "verification_gap",
]);

/** Wait, so `retry_with_backoff` means what it says. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class UnifiedExecutionLoop {
  /**
   * Index into `context.outcomes` where the final attempt began.
   *
   * Used so the end-of-run cross-check judges the last attempt rather than the
   * whole history: a run that failed, closed a gap and then succeeded must
   * report success.
   */
  private finalAttemptStart = 0;

  constructor(
    private readonly deps: ExecutionDependencies,
    private readonly config: LoopConfig = {},
  ) {
    if (typeof deps.runAgent !== "function") {
      throw new Error(
        "UnifiedExecutionLoop requires a `runAgent` dependency. " +
          "Without one the loop would report outcomes for work no agent performed.",
      );
    }
  }

  async run(init: TaskContextInit): Promise<TaskReport> {
    const context = new TaskContext(init);
    this.finalAttemptStart = 0;
    const maxAttempts = this.config.maxAttempts ?? init.budget?.maxRecoveryAttempts ?? 3;
    const failures: Array<{ classification: FailureClassification; recovery: RecoveryDecision }> = [];
    const gaps: DetectedGap[] = [];

    if (this.config.modelRoute !== undefined) context.modelRoute = this.config.modelRoute;
    if (this.config.fallbackModels !== undefined) {
      context.fallbackModels = [...this.config.fallbackModels];
    }

    await this.emit(context, "task.received", { goal: context.goal });

    let attempt = 0;
    let verification: VerificationReport | undefined;
    let lastStatus: ExecutionStatus = "skipped";

    while (attempt < maxAttempts) {
      attempt += 1;
      context.spend.recoveryAttempts = attempt - 1;
      this.finalAttemptStart = context.outcomes.length;
      // The agent is told which attempt this is; retrying without saying so
      // invites the same failing move a second time.
      context.attempt = attempt;

      const overBudget = context.budgetExceeded();
      if (overBudget) {
        context.addOutcome(outcome("blocked", `Stopped before attempt ${attempt}: ${overBudget}`));
        lastStatus = "blocked";
        break;
      }

      // ── OBSERVE / UNDERSTAND ─────────────────────────────────────────
      context.enterPhase("observing", `Attempt ${attempt}`);
      context.observe("loop", `Attempt ${attempt} of ${maxAttempts} for: ${context.goal}`);

      // ── RECALL ───────────────────────────────────────────────────────
      context.enterPhase("recalling", "Retrieving relevant memory");
      if (this.deps.recall) {
        try {
          const memories = await this.deps.recall(context);
          context.memories.push(...memories);
          context.addOutcome(
            outcome("executed", `Recalled ${memories.length} memories`, { value: memories.length }),
          );
        } catch (error) {
          context.addOutcome(
            outcome("failed", `Recall failed: ${this.messageOf(error)}`, { error: this.messageOf(error) }),
          );
        }
      } else {
        context.addOutcome(outcome("unavailable", "No recall provider was supplied"));
      }

      // ── PLAN ─────────────────────────────────────────────────────────
      context.enterPhase("planning", "Producing a plan");
      if (this.deps.plan) {
        try {
          const steps = await this.deps.plan(context);
          const plan = buildPlan(steps);
          context.plan = plan;

          // A plan is only usable if its graph is. Both checks below used to be
          // impossible to make, because the loop flattened plans to strings and
          // discarded the edges the planner had already computed.
          const unresolved = unresolvedDependencies(plan);
          const cycles = cyclicSteps(plan);

          if (steps.length === 0) {
            // An empty plan is a planning failure, not a silent pass. This is
            // the precise shape of the original bug.
            context.addOutcome(outcome("failed", "Planner produced zero steps"));
          } else if (cycles.length > 0) {
            // No step in a cycle can ever become ready, so the plan cannot be
            // executed in any order. Reporting `executed` here would hand the
            // agent a plan guaranteed to stall.
            context.addOutcome(
              outcome("failed", `Plan has a dependency cycle: ${cycles.join(" → ")}`, {
                error: "cyclic_plan",
              }),
            );
          } else if (unresolved.length > 0) {
            context.addOutcome(
              outcome("failed", `Plan depends on unknown steps: ${unresolved.join(", ")}`, {
                error: "unresolved_dependencies",
              }),
            );
          } else {
            const withEdges = plan.steps.filter((step) => step.dependencies.length > 0).length;
            context.addOutcome(
              outcome(
                "executed",
                `Planned ${steps.length} steps (${readySteps(plan).length} ready, ${withEdges} with dependencies)`,
                { value: steps.length },
              ),
            );
          }
        } catch (error) {
          context.addOutcome(
            outcome("failed", `Planning failed: ${this.messageOf(error)}`, { error: this.messageOf(error) }),
          );
        }
      } else {
        context.addOutcome(outcome("unavailable", "No planner was supplied"));
      }

      // ── ACT: the real agent ──────────────────────────────────────────
      context.enterPhase("acting", "Running the agent");
      await this.emit(context, "task.acting", { attempt });

      let agentResult: AgentRunResult;
      const actStartedAt = Date.now();
      try {
        agentResult = await this.deps.runAgent(context);
      } catch (error) {
        agentResult = {
          completed: false,
          summary: "Agent threw",
          error: this.messageOf(error),
        };
      }
      const actDurationMs = Date.now() - actStartedAt;

      if (agentResult.sessionId) context.sessionId = agentResult.sessionId;
      if (agentResult.tokens) context.spendTokens(agentResult.tokens);
      if (agentResult.toolCalls) context.spendToolCall(agentResult.toolCalls);
      if (agentResult.costUsd) context.spendCost(agentResult.costUsd);

      context.addOutcome(
        outcome(agentResult.completed ? "executed" : "failed", agentResult.summary, {
          durationMs: actDurationMs,
          error: agentResult.error,
        }),
      );
      context.observe("agent", agentResult.summary);
      this.recordStepProgress(context, agentResult);

      // Carry this attempt's failure into the next briefing. Without it the
      // retry is identical to the try that just failed, which is how a loop
      // burns three attempts producing the same error three times.
      if (!agentResult.completed) {
        context.priorFailures.push(agentResult.error ?? agentResult.summary);
      }

      // ── VERIFY ───────────────────────────────────────────────────────
      context.enterPhase("verifying", "Checking the result");
      verification = await this.verify(context);

      context.addOutcome(
        outcome(verification.status, verification.summary, { durationMs: undefined }),
      );

      // A failed verification is the most useful thing to tell the next
      // attempt: it is concrete, external and reproducible.
      if (verification.verdict === "fail") {
        context.priorFailures.push(`Verification failed: ${verification.summary}`);
      }

      await this.emit(context, "task.verified", {
        attempt,
        verdict: verification.verdict,
        tier: verification.strongestTier,
      });

      // ── BRANCH ───────────────────────────────────────────────────────
      if (verification.verdict === "pass") {
        lastStatus = "succeeded";
        context.enterPhase("learning", "Recording what worked");
        break;
      }

      if (verification.verdict === "uncertain" && agentResult.completed) {
        // The honest middle: work happened, nothing can confirm it.
        lastStatus = this.config.acceptUnverified ? "executed" : "unverified";
        if (this.config.acceptUnverified) {
          break;
        }
      } else {
        lastStatus = "failed";
      }

      // ── ANALYSE FAILURE ──────────────────────────────────────────────
      context.enterPhase("recovering", `Attempt ${attempt} did not verify`);

      const failureMessage =
        agentResult.error ??
        (verification.verdict === "uncertain" ? verification.summary : verification.summary);

      const classification = classifyFailure(failureMessage, { attemptCount: attempt, phase: "verifying" });
      const recovery = chooseRecovery(classification, {
        attemptsUsed: attempt,
        maxAttempts,
        budgetExceeded: context.budgetExceeded(),
      });

      failures.push({ classification, recovery });

      // ── DETECT GAP ───────────────────────────────────────────────────
      // Only worth doing when the failure suggests something is missing.
      // Running it on, say, a timeout would manufacture a gap that is not there.
      if (GAP_WORTHY.has(classification.kind)) {
        const inventory = this.deps.inventory
          ? await this.deps.inventory().catch(() => undefined)
          : undefined;

        const report = detectGaps({
          goal: context.goal,
          inventory: inventory ?? { capabilityIds: [] },
          failureKind: classification.kind,
          failureMessage,
        });

        for (const gap of report.gaps) {
          if (!gaps.some((existing) => existing.missing === gap.missing)) gaps.push(gap);
        }

        if (report.gaps.length > 0) {
          context.addOutcome(
            outcome("executed", `Gap detection: ${report.summary}`, { value: report.gaps.length }),
          );
          await this.emit(context, "task.gap.detected", {
            attempt,
            gaps: report.gaps.map((gap) => ({ missing: gap.missing, type: gap.type, confidence: gap.confidence })),
            inventoryKnown: inventory !== undefined,
          });
        }

        // ── ACQUIRE CAPABILITY → RETRY ORIGINAL TASK ───────────────────
        if (recovery.strategy === "acquire_capability" && report.actionable) {
          if (!this.deps.acquireCapability) {
            // The gap is named and actionable, but nothing can build it. Say
            // exactly that instead of retrying an action that cannot work.
            context.addOutcome(
              outcome(
                "unavailable",
                `Gap '${report.actionable.missing}' identified but no capability-acquisition provider is wired. ` +
                  `Retrying would fail identically.`,
              ),
            );
            lastStatus = "failed";
            break;
          }

          const acquired = await this.deps
            .acquireCapability(report.actionable, context)
            .catch(() => false);

          context.addOutcome(
            outcome(
              acquired ? "executed" : "failed",
              acquired
                ? `Acquired capability '${report.actionable.missing}'; retrying the original task`
                : `Could not acquire capability '${report.actionable.missing}'`,
            ),
          );

          await this.emit(context, "task.capability.acquisition", {
            attempt,
            missing: report.actionable.missing,
            acquired,
          });

          if (!acquired) {
            lastStatus = "failed";
            break;
          }
          // Acquired: fall through to the next iteration, which re-runs the
          // ORIGINAL goal — the point of the whole exercise.
          continue;
        }
      }
      context.fail("verifying", failureMessage, {
        category: classification.kind,
        recoverable: recovery.canContinue,
      });

      // A verification gap is not fixed by doing the work again. The agent
      // completed; what is missing is a way to check it. Re-running would
      // produce the same unverifiable result and spend the budget twice, so
      // the loop stops and reports the honest answer instead.
      if (recovery.strategy === "add_verification" && agentResult.completed) {
        context.addOutcome(
          outcome(
            "unverified",
            "Stopped retrying: the work completed but no verifier exists for it. " +
              "Repeating the work cannot make it verifiable.",
          ),
        );
        lastStatus = "unverified";
        await this.emit(context, "task.verification.gap", {
          attempt,
          reason: "no verifier available; retry would not change the outcome",
        });
        break;
      }

      await this.emit(context, "task.failure.classified", {
        attempt,
        kind: classification.kind,
        confidence: classification.confidence,
        strategy: recovery.strategy,
        canContinue: recovery.canContinue,
      });

      if (!recovery.canContinue) {
        context.addOutcome(
          outcome(
            recovery.strategy === "abort" ? "blocked" : "failed",
            `Recovery stopped: ${recovery.rationale}`,
          ),
        );
        break;
      }

      // ── APPLY THE RECOVERY DECISION ──────────────────────────────────
      // Without this, every continuable strategy did the same thing: run the
      // same agent on the same input. `replan` did not replan, `reduce_scope`
      // reduced nothing, and `retry_with_backoff` never waited. The strategy
      // was a label on a report rather than a change in behaviour.
      context.recoveryDirective = recovery.directive;

      // `change_tool` used to be advice only. Now the failing tool is named
      // and carried forward, so the next attempt can steer away from it.
      if (recovery.strategy === "change_tool") {
        const failedTool = agentResult.failedTool;
        if (failedTool !== undefined && !context.avoidTools.includes(failedTool)) {
          context.avoidTools.push(failedTool);
          await this.emit(context, "task.recovery.tool_avoided", { attempt, tool: failedTool });
        } else if (failedTool === undefined) {
          // The interface failed but no tool could be named. Saying "switched
          // tools" here would be a recovery that never happened; the agent is
          // told to re-check the interface instead.
          context.addOutcome(
            outcome(
              "executed",
              "Interface failure, but could not identify a specific tool to avoid; " +
                "the next attempt is told to re-check the interface rather than switch blindly.",
            ),
          );
          await this.emit(context, "task.recovery.tool_unidentified", { attempt });
        }
      }

      // `change_model` used to be advice only. The route actually moves now,
      // so the next attempt does not re-run the model that just failed.
      if (recovery.strategy === "change_model") {
        const previous = context.modelRoute;
        const next = context.escalateModel();
        if (next === undefined) {
          // No alternative exists. Say so — a report claiming a model change
          // that did not happen is the same lie as a fabricated success.
          context.addOutcome(
            outcome(
              "failed",
              `No alternative model to escalate to (still on ${previous ?? "the default route"}); ` +
                "retrying the same model is unlikely to help.",
            ),
          );
          await this.emit(context, "task.recovery.model_exhausted", {
            attempt,
            route: previous ?? null,
          });
        } else {
          await this.emit(context, "task.recovery.model_changed", {
            attempt,
            from: previous ?? null,
            to: next,
          });
        }
      }

      if (recovery.backoffMs !== undefined && recovery.backoffMs > 0) {
        await this.emit(context, "task.recovery.backoff", {
          attempt,
          waitMs: recovery.backoffMs,
          reason: classification.kind,
        });
        await sleep(recovery.backoffMs);
      }
    }

    // ── LEARN ──────────────────────────────────────────────────────────
    const report = this.buildReport(context, lastStatus, verification, attempt, failures, gaps);

    if (this.deps.learn) {
      try {
        await this.deps.learn(context, report);
      } catch {
        // Learning must never change the verdict of the task it learned from.
      }
    }

    context.enterPhase("idle", `Finished as ${report.status}`);
    await this.emit(context, report.status === "succeeded" ? "task.completed" : "task.failed", {
      status: report.status,
      attempts: attempt,
    });

    return report;
  }

  private async verify(context: TaskContext): Promise<VerificationReport> {
    const factory = new VerificationFactory();

    if (this.deps.verifiersFor) {
      try {
        const verifiers = await this.deps.verifiersFor(context);
        for (const verifier of verifiers) factory.register(verifier);
      } catch (error) {
        context.observe("verification", `Could not build verifiers: ${this.messageOf(error)}`);
      }
    }

    // With no verifiers this returns `uncertain`, which is correct and is the
    // whole point: nothing checked the work, so nothing may claim it passed.
    return factory.verify(context.goal);
  }

  private buildReport(
    context: TaskContext,
    status: ExecutionStatus,
    verification: VerificationReport | undefined,
    attempts: number,
    failures: ReadonlyArray<{ classification: FailureClassification; recovery: RecoveryDecision }>,
    gaps: readonly DetectedGap[],
  ): TaskReport {
    // Cross-check the narrative status against the accumulated evidence, so a
    // headline of "succeeded" cannot outrun what actually happened.
    //
    // Scope matters here. Earlier attempts are *expected* to contain failures —
    // that is what recovery is for. Judging the whole run by every outcome ever
    // recorded would mean a task that failed, acquired the missing capability
    // and then succeeded still reported `failed`, which punishes the recovery
    // loop for doing its job. Only evidence from the final attempt can
    // contradict the final verdict.
    const finalAttemptOutcomes = context.outcomes.slice(this.finalAttemptStart);
    const aggregated = aggregate(finalAttemptOutcomes);
    const finalStatus: ExecutionStatus =
      status === "succeeded" && aggregated === "failed" ? "failed" : status;

    return {
      taskId: context.taskId,
      status: finalStatus,
      goal: context.goal,
      verification,
      attempts,
      failures,
      gaps,
      outcomes: context.outcomes,
      plan: context.plan,
      spend: context.spend,
      durationMs: context.elapsedMs,
      trace: context.trace,
      summary: this.summarise(finalStatus, verification, attempts, failures, context.plan),
    };
  }

  /**
   * Give every plan step the truest status the evidence supports.
   *
   * Three cases, in descending order of evidence:
   *
   *  - The adapter attributed outcomes to steps → use them verbatim.
   *  - The agent ran and finished → steps that were ready are `unverified`.
   *    Work happened, but nothing tied it to a specific step, and `succeeded`
   *    would claim more than is known.
   *  - The agent failed → nothing is marked done; `blockUnreachable` then
   *    distinguishes steps that were blocked from steps never reached.
   *
   * The temptation is to mark ready steps `succeeded` when the agent reports
   * completion. That is precisely the inference that produced "10/10, score
   * 1.0" from an agent that never ran.
   */
  private recordStepProgress(context: TaskContext, result: AgentRunResult): void {
    const plan = context.plan;
    if (plan === undefined || plan.steps.length === 0) return;

    if (result.stepResults !== undefined && result.stepResults.length > 0) {
      for (const step of result.stepResults) {
        markStep(plan, step.id, step.status, step.detail);
      }
    } else if (result.completed) {
      for (const step of readySteps(plan)) {
        markStep(
          plan,
          step.id,
          "unverified",
          "Agent completed the goal but did not report per-step outcomes",
        );
      }
    }

    // Steps whose prerequisites can no longer succeed are blocked, not failed:
    // they never got their turn. Runs after every attempt so a later attempt
    // can still unblock them.
    blockUnreachable(plan);
  }

  private summarise(
    status: ExecutionStatus,
    verification: VerificationReport | undefined,
    attempts: number,
    failures: ReadonlyArray<{ classification: FailureClassification; recovery: RecoveryDecision }>,
    plan: TaskContext["plan"],
  ): string {
    // Plan progress belongs in the sentence a human reads. A report that says
    // "succeeded" while four of six steps were never reached is technically
    // true about the goal and misleading about the work.
    const planNote = ((): string => {
      if (plan === undefined || plan.steps.length === 0) return "";
      const counts = planSummary(plan);
      const parts = [`${counts.total} step(s)`];
      if (counts.succeeded > 0) parts.push(`${counts.succeeded} succeeded`);
      if (counts.failed > 0) parts.push(`${counts.failed} failed`);
      if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
      if (counts.untouched > 0) parts.push(`${counts.untouched} not attempted`);
      return ` Plan: ${parts.join(", ")}.`;
    })();

    if (status === "succeeded") {
      return `Verified after ${attempts} attempt(s). ${verification?.summary ?? ""}${planNote}`.trim();
    }
    if (status === "unverified") {
      return (
        `The agent completed its run but nothing could confirm the result, so this is not reported ` +
        `as success. ${verification?.summary ?? ""}${planNote}`
      ).trim();
    }
    const last = failures[failures.length - 1];
    if (last) {
      return `Stopped after ${attempts} attempt(s) as ${status}: ${last.classification.kind} — ${last.recovery.rationale}${planNote}`;
    }
    return `Stopped after ${attempts} attempt(s) as ${status}.${planNote}`;
  }

  private async emit(context: TaskContext, type: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.deps.emit) return;
    try {
      await this.deps.emit({
        type,
        taskId: context.taskId,
        sessionId: context.sessionId,
        traceId: context.traceId,
        correlationId: context.correlationId,
        causationId: randomUUID(),
        at: new Date().toISOString(),
        payload,
      });
    } catch {
      // An observer must not be able to fail the thing it observes.
    }
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
