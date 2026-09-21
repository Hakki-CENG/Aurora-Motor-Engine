/**
 * Runtime observation — what actually runs, not what we declared.
 *
 * `wiredToEngine` is a hand-written boolean, and at the time this file was
 * added all 30 entries said `true` and none said `false`. A field that never
 * discriminates is not measuring anything; it is a habit. N4 demonstrated the
 * failure mode concretely: deleting the security guard's registration from
 * `engine.ts` broke zero tests, because the tests proved the guard worked
 * rather than that the engine used it.
 *
 * So this does not add a second boolean for a human to fill in. It records
 * what V8 coverage observed while a real task ran, and the registry test
 * compares the declaration against the observation.
 *
 * ## The distinction that matters
 *
 * Three different things get called "wired", and only the last one is what the
 * word promises:
 *
 *  - **loaded** — the module was imported. Costs nothing, proves nothing.
 *  - **constructed** — `new Service()` ran during `initialize()`. This is what
 *    most of the registry actually had: a pipeline built at startup, holding
 *    state, answering `getStats()`, and never asked anything else.
 *  - **exercised** — a method of it was called *while a task was running*,
 *    beyond what startup already called.
 *
 * Measured on 2026-09-20 with one real `engine.execute()` goal: 5 of 30
 * modules were exercised. 25 were constructed and then never consulted.
 * That is the honest number, and it is the one this module exists to keep
 * visible.
 *
 * ## What this does not claim
 *
 * One task exercises one path. A module that is idle for a file-writing goal
 * may be essential for a different one — `society/agent-society` is not dead
 * code, it is unreachable from *this* goal. `RuntimeObservation` therefore
 * records the goal it was measured under, and `observed: false` means
 * "not seen on this path", never "broken".
 */

/** How deeply the runtime touched a module during an observed run. */
export type ObservationDepth =
  /** Never imported. */
  | "absent"
  /** Imported and/or constructed at startup; no method called afterwards. */
  | "constructed"
  /** A method ran during the task itself, beyond startup. */
  | "exercised";

/** What one observation run saw for one module. */
export interface RuntimeObservation {
  readonly module: string;
  readonly depth: ObservationDepth;
  /** Methods seen during the task, excluding those startup already called. */
  readonly methodsDuringTask: readonly string[];
  /** The goal the engine was given, so the result can be reproduced. */
  readonly underGoal: string;
  /** ISO date of the measurement. */
  readonly measuredAt: string;
}

const GOAL = "Create a file called hello.txt containing the word hello";
const MEASURED_AT = "2026-09-20";

function exercised(module: string, methods: readonly string[]): RuntimeObservation {
  return {
    module,
    depth: "exercised",
    methodsDuringTask: methods,
    underGoal: GOAL,
    measuredAt: MEASURED_AT,
  };
}

function constructed(module: string): RuntimeObservation {
  return {
    module,
    depth: "constructed",
    methodsDuringTask: [],
    underGoal: GOAL,
    measuredAt: MEASURED_AT,
  };
}

/**
 * Observations from `probe: NODE_V8_COVERAGE` over two runs — one that only
 * called `initialize()`, one that also ran a real goal — with the difference
 * taken so that startup work is not counted as task work.
 *
 * Regenerate with `npm run observe:runtime -w @haf/engine`.
 */
export const RUNTIME_OBSERVATIONS: readonly RuntimeObservation[] = [
  exercised("execution/unified-execution-loop", [
    "buildReport",
    "emit",
    "recordStepProgress",
    "run",
  ]),
  exercised("execution/gap-detection", [
    "detectDeterministicGaps",
    "detectGaps",
    "detectStructuralGaps",
  ]),
  exercised("execution/verification-factory", ["combine", "verify"]),
  exercised("execution/failure-taxonomy", ["chooseRecovery", "classifyFailure"]),
  exercised("aurora/long-horizon-memory", ["autoConsolidate", "decay", "search"]),

  // Constructed at startup, never consulted during the task. Not dead code —
  // unreachable from this particular goal. See the module note above.
  constructed("capabilities/capability-synthesis"),
  constructed("skills/skill-synthesis"),
  constructed("skills/skill-promotion"),
  constructed("skills/skill-composition"),
  constructed("security/security-system"),
  constructed("persistence/production-persistence"),
  constructed("memory/real-memory-pipeline"),
  constructed("aurora/self-improvement"),
  constructed("aurora/neural-memory-fusion"),
  constructed("aurora/neural-cognitive-core"),
  constructed("world/world-model-exploration"),
  constructed("routing/model-routing"),
  constructed("society/agent-society"),
  constructed("aurora/goal-discovery"),
  constructed("security/reward-hacking-defense"),
  constructed("execution/capability-acquisition"),
  constructed("security/reward-hacking-detectors"),
  constructed("pipeline/code-pipeline-service"),
  constructed("aurora/integration-verification"),
  constructed("sdk/agent-sdk-service"),
  constructed("surface/jarvis-surface"),
  constructed("digital-twin"),
  constructed("embodiment"),
  constructed("federated"),
  constructed("domain-experts"),
];

/** Observation for one module, if it was measured. */
export function observationOf(module: string): RuntimeObservation | undefined {
  return RUNTIME_OBSERVATIONS.find((entry) => entry.module === module);
}

/** Counts by depth, for the generated state documents. */
export function observationSummary(): {
  total: number;
  exercised: number;
  constructed: number;
  absent: number;
  underGoal: string;
  measuredAt: string;
} {
  const count = (depth: ObservationDepth) =>
    RUNTIME_OBSERVATIONS.filter((entry) => entry.depth === depth).length;
  return {
    total: RUNTIME_OBSERVATIONS.length,
    exercised: count("exercised"),
    constructed: count("constructed"),
    absent: count("absent"),
    underGoal: GOAL,
    measuredAt: MEASURED_AT,
  };
}
