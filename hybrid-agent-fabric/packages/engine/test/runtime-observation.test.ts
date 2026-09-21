import { describe, expect, it } from "vitest";

import { MODULE_MATURITY } from "../src/experimental/maturity.js";
import {
  RUNTIME_OBSERVATIONS,
  observationOf,
  observationSummary,
} from "../src/experimental/runtime-observation.js";

/**
 * `wiredToEngine` was a hand-written boolean that said `true` for all 30
 * modules and `false` for none. A field that never discriminates is not
 * measuring anything.
 *
 * These tests hold the measured number in place so the gap between "declared
 * wired" and "observed doing work" cannot quietly close on paper.
 */
describe("runtime observation", () => {
  it("covers every module in the maturity registry", () => {
    // An unobserved module is the easiest place for the old habit to return.
    const missing = MODULE_MATURITY.filter((entry) => !observationOf(entry.module));
    expect(missing.map((entry) => entry.module)).toEqual([]);
  });

  it("records that most modules are constructed but not exercised", () => {
    const summary = observationSummary();

    // The honest headline: 5 of 30 did work during a real task.
    expect(summary.exercised).toBe(5);
    expect(summary.constructed).toBe(25);
    expect(summary.total).toBe(MODULE_MATURITY.length);
  });

  it("keeps the declaration and the observation visibly different", () => {
    const declaredWired = MODULE_MATURITY.filter((entry) => entry.wiredToEngine).length;
    const observedWorking = observationSummary().exercised;

    // If these ever match, it should be because the system changed, not
    // because someone edited the registry. The assertion is deliberately an
    // inequality: closing this gap is a real engineering result, and it should
    // require deleting this test on purpose.
    expect(declaredWired).toBeGreaterThan(observedWorking);
  });

  it("names the methods it saw, not just a boolean", () => {
    // "Exercised" has to be auditable, otherwise it is the same unfalsifiable
    // claim as `wiredToEngine: true` with a longer name.
    const loop = observationOf("execution/unified-execution-loop");
    expect(loop?.depth).toBe("exercised");
    expect(loop?.methodsDuringTask).toContain("run");

    for (const entry of RUNTIME_OBSERVATIONS) {
      if (entry.depth === "exercised") {
        expect(entry.methodsDuringTask.length).toBeGreaterThan(0);
      } else {
        expect(entry.methodsDuringTask).toEqual([]);
      }
    }
  });

  it("records the goal it was measured under", () => {
    // One task exercises one path. Without the goal, `constructed` reads as
    // "dead code" when it often means "not reachable from this goal".
    for (const entry of RUNTIME_OBSERVATIONS) {
      expect(entry.underGoal.length).toBeGreaterThan(0);
      expect(entry.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("does not count startup work as task work", () => {
    // security-system is constructed and armed during initialize(); its guard
    // only runs when a capability executes, which this goal never reached.
    // Marking it "exercised" would make the measurement flattering and wrong.
    expect(observationOf("security/security-system")?.depth).toBe("constructed");
    expect(observationOf("capabilities/capability-synthesis")?.depth).toBe("constructed");
  });
});
