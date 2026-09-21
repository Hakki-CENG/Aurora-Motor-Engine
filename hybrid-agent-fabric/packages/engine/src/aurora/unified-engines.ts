/**
 * Unified Engines — Aurora Cognitive Runtime
 *
 * Bu dosya, birden fazla alt servisi tek birleşik arayüzde toplayan
 * facade sınıfları tanımlar. Üst katman (Meta Controller) bu
 * arayüzleri kullanır; alt servislerin kaç tane olduğunu bilmez.
 */

import type { EventBus } from "./event-bus.js";
import type { CognitiveState } from "./cognitive-state.js";
import type { MemoryGraphService } from "../memory/memory-graph-service.js";
import type { LongHorizonMemoryService } from "./long-horizon-memory.js";
import type { NeuralMemoryFusionService } from "./neural-memory-fusion.js";
import type { ExperienceCompilerService } from "./experience-compiler.js";
import type { SleepCycleService } from "./sleep-cycle.js";
import type { SharedLearningService } from "./shared-learning.js";
import type { PlanningService } from "./planning-service.js";
import type { PlannerV2Service } from "./planner-v2.js";
import type { GoalStackService } from "./goal-stack.js";
import type { WorldModelService } from "../world/world-model-service.js";
import type { LearnedWorldModelService } from "./learned-world-model.js";
import type { CausalGraphService } from "./causal-graph.js";
import type { CounterfactualSimulatorService } from "./counterfactual-simulator.js";
import type { MultiHypothesisReasoningService } from "./multi-hypothesis-reasoning.js";
import type { InternalCriticService } from "./internal-critic.js";
import type { ExperimentEngineService } from "./experiment-engine.js";
import type { NeuralCognitiveCoreService } from "./neural-cognitive-core.js";
import type { ModelRouter } from "../models/model-router.js";
import type { AdaptiveRouterService } from "./adaptive-router.js";
import type { AttentionV2Service } from "./attention-v2.js";
import type { CognitiveWorkspaceService } from "../cognitive/cognitive-workspace-service.js";
import type { SelfModelService } from "./self-model-service.js";
import type { FailureTaxonomyService } from "./failure-taxonomy.js";
import type { ResourceIntelligenceService } from "./resource-intelligence.js";

// ─────────────────────────────────────────────
// 1. MEMORY ENGINE
// ─────────────────────────────────────────────

export interface MemoryQuery {
  text: string;
  tenantId: string;
  limit?: number | undefined;
}

export interface MemoryResult {
  memories: Array<{ id: string; content: string; importance: number; source: string }>;
  totalFound: number;
}

/**
 * Memories returned when the caller does not specify a limit.
 *
 * `engine.execute()` calls `recall()` without one, so this bound is what
 * actually reaches the agent's prompt on the main execution path.
 */
const DEFAULT_RECALL_LIMIT = 5;

export class MemoryEngine {
  constructor(
    private graph: MemoryGraphService,
    private longHorizon: LongHorizonMemoryService,
    private fusion: NeuralMemoryFusionService,
    private experience: ExperienceCompilerService,
    private sharedLearning: SharedLearningService,
    private bus: EventBus,
    private state: CognitiveState,
  ) {}

  async recall(query: MemoryQuery): Promise<MemoryResult> {
    await this.bus.emit("memory.recalled", "MemoryEngine", { query: query.text, tenantId: query.tenantId });

    const limit = query.limit ?? DEFAULT_RECALL_LIMIT;

    // Both stores are asked for `limit` candidates, then the merged set is
    // ranked and truncated to `limit`.
    //
    // Previously the graph received the limit and long-horizon did not, and
    // the two result sets were concatenated raw. `search()` returns up to 20
    // rows of its own, so `recall({ limit: 3 })` measured 23 memories — and
    // since `execute()` calls this without a limit and the loop's `learn`
    // step writes a memory after every task, the overflow grew with use and
    // silently inflated every prompt.
    const [graphResults, horizonResults] = await Promise.all([
      this.graph.recall(query.tenantId, query.text, { limit }),
      this.longHorizon.search(query.tenantId, query.text),
    ]);

    const merged = [
      ...graphResults.map(m => ({
        id: m.memory.id,
        content: m.memory.content,
        importance: m.memory.importance,
        source: "graph" as const,
      })),
      ...horizonResults.map(m => ({
        id: m.id,
        content: m.content,
        importance: m.importance,
        source: "long-horizon" as const,
      })),
    ];

    // Rank before truncating. Cutting the raw concatenation would keep the
    // graph's results purely because that store is listed first and drop a
    // more important long-horizon memory — the caller asked for the best
    // `limit` memories, not the first `limit` found.
    const memories = await this.rank(query.text, merged, limit);

    this.state.updateBudget({ memoryOperations: this.state.snapshot().resourceBudget.memoryOperations + 1 });

    // `totalFound` reports what was returned, matching `memories.length`.
    // Reporting the pre-truncation count here would tell a caller it received
    // more context than it did.
    return { memories, totalFound: memories.length };
  }

  /**
   * Order candidates by relevance to the query, falling back to importance.
   *
   * The two stores return candidates; neither ranks them against the question
   * being asked. Sorting by `importance` alone answered "what matters most in
   * general", not "what matters most here" — a memory written with importance
   * 0.9 about deployments outranked an exactly-matching 0.4 memory about the
   * bug at hand.
   *
   * `RealMemoryPipeline` already implements BM25 + vector + RRF + reranking
   * and is measured by `npm run eval:recall` (Recall@8 0.317 -> 0.400 with a
   * real encoder). It held zero references outside the eval harness: the
   * ranking the project measures was not the ranking the agent got.
   *
   * It is used here as a ranker over candidates the durable stores produced,
   * not as a store. The pipeline keeps its corpus in memory, so making it the
   * system of record would silently drop memories on restart.
   *
   * Falls back to importance ordering when ranking cannot run. A failure to
   * rank must not become a failure to recall.
   */
  private async rank(
    queryText: string,
    candidates: Array<{ id: string; content: string; importance: number; source: string }>,
    limit: number,
  ): Promise<Array<{ id: string; content: string; importance: number; source: string }>> {
    // Sort is stable in Node, so equal-importance memories keep graph-then-
    // horizon order rather than shuffling between calls.
    const byImportance = [...candidates].sort((a, b) => b.importance - a.importance);
    if (candidates.length <= 1) return byImportance.slice(0, limit);

    try {
      const { RealMemoryPipeline } = await import("../memory/real-memory-pipeline.js");
      // No embedding provider: the default hash encoder is not semantic and
      // carries zero fusion weight, so supplying it would add noise. Lexical
      // BM25 over the candidate set is the honest improvement available here.
      const pipeline = new RealMemoryPipeline();
      await pipeline.addMemories(
        candidates.map((item) => ({
          content: item.content,
          layer: "semantic" as const,
          metadata: { originalId: item.id },
        })),
      );

      const ranked = await pipeline.search(queryText, { limit: candidates.length });
      const byId = new Map(candidates.map((item) => [item.id, item]));

      // Lexical overlap decides relevance; importance decides everything else.
      //
      // `bm25Score` is the signal, not the pipeline's combined `score`.
      // Measured on the two cases that matter:
      //
      //   every candidate matches equally ("postgres migration" against seven
      //   memories that all say it) -> bm25 0.0988..0.1360, a 27% spread that
      //   is pure length normalisation and says nothing about relevance, while
      //   the combined score still ordered a 0.2 minor note above a 0.99
      //   "always take a backup first".
      //
      //   one candidate actually matches ("why did the postgres migration
      //   fail") -> bm25 2.69 versus 0.00 for the others.
      //
      // The combined score is never zero — RRF gives every document a rank
      // contribution — so it cannot distinguish "matched weakly" from "did not
      // match". bm25 can, and that is exactly the distinction needed here.
      const relevance = new Map<string, number>();
      for (const hit of ranked) {
        const originalId = hit.metadata?.["originalId"];
        if (typeof originalId === "string" && byId.has(originalId)) {
          relevance.set(originalId, hit.bm25Score);
        }
      }

      const matched = [...relevance.values()].filter((value) => value > 0);
      const spread = matched.length > 0 ? Math.max(...matched) / Math.min(...matched) : 1;

      // When the best and worst matches are within a small factor of each
      // other, every candidate answers the query about equally well and the
      // remaining differences are length normalisation. Importance is then the
      // only meaningful tiebreak.
      const relevanceIsInformative = spread >= 2;

      // Candidates the ranker scored at zero keep relevance 0 and are ordered
      // by importance among themselves rather than dropped: a lexical miss is
      // not evidence of irrelevance, and the caller asked for `limit`
      // memories.
      const ordered = [...candidates].sort((a, b) => {
        if (relevanceIsInformative) {
          const byRelevance = (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0);
          if (Math.abs(byRelevance) > 1e-9) return byRelevance;
        }
        return b.importance - a.importance;
      });

      return ordered.slice(0, limit);
    } catch {
      return byImportance.slice(0, limit);
    }
  }

  async store(tenantId: string, content: string, importance: number, category: string): Promise<string> {
    const result = await this.graph.remember({
      tenantId,
      title: content.slice(0, 100),
      content,
      layer: importance > 0.8 ? "semantic" : importance > 0.5 ? "episodic" : "working",
      claimType: "observation",
      sourceType: "agent" as any,
      confidence: importance,
      importance,
      tags: [category],
    });

    await this.bus.emit("memory.stored", "MemoryEngine", { id: result.id, category, importance });

    return result.id;
  }

  getStats() {
    return { status: "active" };
  }

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Engine-level service"], details: {} };
  }
}


// ─────────────────────────────────────────────
// 2. REASONING ENGINE
// ─────────────────────────────────────────────

export interface ReasoningRequest {
  question: string;
  context: string;
  tenantId: string;
}

export interface ReasoningResult {
  answer: string;
  confidence: number;
  hypothesisId: string;
  critiqueNotes: string[];
  patternsMatched: number;
  recommendedAction: string;
}

export class ReasoningEngine {
  constructor(
    private hypothesis: MultiHypothesisReasoningService,
    private critic: InternalCriticService,
    private experiments: ExperimentEngineService,
    private neural: NeuralCognitiveCoreService,
    private causal: CausalGraphService,
    private bus: EventBus,
    private state: CognitiveState,
  ) {}

  async reason(req: ReasoningRequest): Promise<ReasoningResult> {
    this.state.setMode("reasoning", `Reasoning: ${req.question.slice(0, 50)}`);

    // 1. Hipotez üret
    const h = await this.hypothesis.proposeHypothesis(req.tenantId, req.question, "general", [req.context]);

    await this.bus.emit("hypothesis.proposed", "ReasoningEngine", {
      hypothesisId: h.id,
      statement: h.statement,
    });

    // 2. Neural pattern matching
    const activation = await this.neural.activate(req.question, req.context);

    // 3. Critic ile kontrol et
    const review = await this.critic.review(req.tenantId, h.id, "hypothesis", h.statement, req.context);
    const critiqueNotes = review.critiques.map(c => c.description);

    if (critiqueNotes.length > 0) {
      await this.bus.emit("critic.flagged", "ReasoningEngine", {
        hypothesisId: h.id,
        critiqueCount: critiqueNotes.length,
      }, { severity: "warning" });
    }

    // 4. Confidence hesapla
    const baseConfidence = h.confidence;
    const criticPenalty = critiqueNotes.length * 0.1;
    const patternBonus = activation.matchedPattern ? 0.1 : 0;
    const finalConfidence = Math.max(0, Math.min(1, baseConfidence - criticPenalty + patternBonus));

    this.state.setConfidence(
      finalConfidence > 0.8 ? "confident" :
      finalConfidence > 0.6 ? "moderate" :
      finalConfidence > 0.4 ? "uncertain" : "speculative"
    );

    return {
      answer: h.statement,
      confidence: finalConfidence,
      hypothesisId: h.id,
      critiqueNotes,
      patternsMatched: activation.matchedPattern ? 1 : 0,
      recommendedAction: critiqueNotes.length > 0 ? "revise" : "proceed",
    };
  }

  getStats() {
    return { status: "active" };
  }

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Engine-level service"], details: {} };
  }
}


// ─────────────────────────────────────────────
// 3. PLANNING ENGINE
// ─────────────────────────────────────────────

export interface PlanningRequest {
  goal: string;
  tenantId: string;
  strategy?: string | undefined;
}

export interface PlanningResult {
  planId: string;
  goal: string;
  steps: Array<{
    name: string;
    description: string;
    /** Names of prerequisite steps. The planner computes a DAG, not a list. */
    dependencies: string[];
    estimatedMs: number;
    risk: string;
  }>;
  strategy: string;
  totalEstimatedMs: number;
}

export class PlanningEngine {
  constructor(
    private planner: PlanningService,
    private plannerV2: PlannerV2Service,
    private goalStack: GoalStackService,
    private bus: EventBus,
    private state: CognitiveState,
  ) {}

  async plan(req: PlanningRequest): Promise<PlanningResult> {
    this.state.setMode("planning", `Planning: ${req.goal.slice(0, 50)}`);

    const goal = await this.goalStack.addGoal(req.tenantId, req.goal, req.goal, "P1", "Plan completed");

    const strategy = req.strategy ?? "balanced";

    // Dynamic step generation based on goal complexity analysis
    const steps = this.decomposeGoal(req.goal, strategy);

    const plan = await this.plannerV2.createPlan(req.tenantId, req.goal, strategy, steps);

    await this.bus.emit("plan.created", "PlanningEngine", { planId: plan.id, goalId: goal.id, stepCount: steps.length });

    // Write into this plan's own slot, not just the shared flat fields.
    // Two concurrent /v1/planning/plan calls used to overwrite each other's
    // activeGoal/activePlan, so a reader got whichever finished last. The slot
    // keeps each plan's record retrievable by planId; the flat fields are still
    // mirrored underneath for existing dashboard readers.
    this.state.beginTask(plan.id, req.tenantId);
    this.state.setActivePlanFor(plan.id, { id: plan.id, goalId: goal.id, currentStep: 0, totalSteps: steps.length, status: "executing" });
    this.state.setActiveGoalFor(plan.id, { id: goal.id, title: req.goal, priority: "P1", progress: 0, status: "active", startedAt: Date.now() });

    return {
      planId: plan.id,
      goal: req.goal,
      // `dependencies` is carried through deliberately. decomposeGoal computes
      // a real DAG and this mapping used to drop the edges, so every consumer
      // downstream saw a flat list and had no way to know the planner had
      // ordered the work.
      steps: steps.map(s => ({
        name: s.name,
        description: s.description,
        dependencies: s.dependencies,
        estimatedMs: s.estimatedMs,
        risk: s.risk,
      })),
      strategy,
      totalEstimatedMs: steps.reduce((sum, s) => sum + s.estimatedMs, 0),
    };
  }

  /**
   * Dynamic goal decomposition — analyzes goal content to generate
   * context-appropriate steps instead of a fixed template.
   */
  private decomposeGoal(goal: string, strategy: string): Array<{
    name: string;
    description: string;
    dependencies: string[];
    estimatedMs: number;
    risk: "low" | "medium" | "high";
  }> {
    const g = goal.toLowerCase();
    const steps: Array<{
      name: string;
    description: string;
      dependencies: string[];
      estimatedMs: number;
      risk: "low" | "medium" | "high";
    }> = [];

    // Always start with understanding
    steps.push({
      name: "Understand",
      description: `Analyze goal, decompose sub-tasks, identify constraints: ${goal.slice(0, 100)}`,
      dependencies: [],
      estimatedMs: g.length > 200 ? 8000 : 4000,
      risk: "low",
    });

    // Research if goal has external knowledge needs
    const needsResearch = g.includes("research") || g.includes("investigate") || g.includes("compare") ||
                          g.includes("find") || g.includes("learn") || g.includes("analyze") ||
                          g.includes("review") || g.includes("araştır") || g.includes("incele");
    if (needsResearch) {
      steps.push({
        name: "Research",
        description: "Gather relevant context from memory, world model, and external sources",
        dependencies: ["Understand"],
        estimatedMs: 10000,
        risk: "low",
      });
    }

    // Planning/design for complex goals
    const needsPlanning = g.includes("implement") || g.includes("build") || g.includes("create") ||
                          g.includes("design") || g.includes("refactor") || g.includes("architect") ||
                          g.includes("develop") || g.includes("geliştir") || g.includes("oluştur") ||
                          g.includes("system") || g.includes("mimari");
    if (needsPlanning) {
      const prev = needsResearch ? "Research" : "Understand";
      steps.push({
        name: "Design",
        description: "Generate candidate approaches, evaluate trade-offs, select best strategy",
        dependencies: [prev],
        estimatedMs: 8000,
        risk: "low",
      });
    }

    // Simulation for high-risk or uncertain goals
    const needsSimulation = g.includes("migrate") || g.includes("refactor") || g.includes("optimize") ||
                            g.includes("production") || g.includes("critical") || g.includes("risk") ||
                            strategy === "conservative";
    if (needsSimulation) {
      const prev = needsPlanning ? "Design" : needsResearch ? "Research" : "Understand";
      steps.push({
        name: "Simulate",
        description: "Run counterfactual analysis, predict outcomes, assess risks",
        dependencies: [prev],
        estimatedMs: 6000,
        risk: "medium",
      });
    }

    // Execution phase
    const execDeps: string[] = [];
    if (needsSimulation) execDeps.push("Simulate");
    else if (needsPlanning) execDeps.push("Design");
    else if (needsResearch) execDeps.push("Research");
    else execDeps.push("Understand");

    const needsCoding = g.includes("code") || g.includes("implement") || g.includes("function") ||
                        g.includes("api") || g.includes("endpoint") || g.includes("component") ||
                        g.includes("file") || g.includes("test") || g.includes("bug") || g.includes("fix");
    const execTime = needsCoding ? 20000 : g.length > 500 ? 15000 : 10000;

    steps.push({
      name: "Execute",
      description: needsCoding
        ? "Implement solution: write code, run tests, verify compilation"
        : "Execute the planned approach with appropriate tools",
      dependencies: execDeps,
      estimatedMs: execTime,
      risk: needsCoding ? "medium" : "low",
    });

    // Verification
    steps.push({
      name: "Verify",
      description: "Validate result against success criteria, run tests, check for regressions",
      dependencies: ["Execute"],
      estimatedMs: 6000,
      risk: "low",
    });

    // Learning
    steps.push({
      name: "Learn",
      description: "Record experience, update memory, extract lessons for future use",
      dependencies: ["Verify"],
      estimatedMs: 3000,
      risk: "low",
    });

    return steps;
  }

  getStats() {
    return { status: "active" };
  }

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Engine-level service"], details: {} };
  }
}


// ─────────────────────────────────────────────
// 4. WORLD ENGINE
// ─────────────────────────────────────────────

export class WorldEngine {
  constructor(
    private worldModel: WorldModelService,
    private learnedWorld: LearnedWorldModelService,
    private causal: CausalGraphService,
    private counterfactual: CounterfactualSimulatorService,
    private bus: EventBus,
    private state: CognitiveState,
  ) {}

  async query(tenantId: string, query?: string): Promise<{ entities: Array<{ id: string; name: string; type: string }> }> {
    const entities = await this.learnedWorld.queryEntities();
    return { entities: entities.map(e => ({ id: e.id, name: e.name, type: e.type })) };
  }

  async observe(tenantId: string, name: string, type: string, properties?: Record<string, string>): Promise<{ entityId: string }> {
    const entity = await this.learnedWorld.observeEntity(name, type as any, properties);
    await this.bus.emit("world.updated", "WorldEngine", { entityId: entity.id, name, type });
    return { entityId: entity.id };
  }

  async simulateCounterfactual(tenantId: string, question: string, context: string): Promise<{ recommended: string; scenarios: number }> {
    const sim = await this.counterfactual.createSimulation(tenantId, question, context);
    return { recommended: sim.id, scenarios: sim.scenarios.length };
  }

  getStats() {
    return { status: "active" };
  }

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Engine-level service"], details: {} };
  }
}


// ─────────────────────────────────────────────
// 5. LEARNING ENGINE
// ─────────────────────────────────────────────

export interface LearningRequest {
  tenantId: string;
  experience: string;
  outcome: "success" | "failure" | "neutral";
  context: string;
  source: string;
}

export class LearningEngine {
  constructor(
    private experienceCompiler: ExperienceCompilerService,
    private sleepCycle: SleepCycleService,
    private sharedLearning: SharedLearningService,
    private selfModel: SelfModelService,
    private failureTaxonomy: FailureTaxonomyService,
    private bus: EventBus,
    private state: CognitiveState,
  ) {}

  async learn(req: LearningRequest): Promise<{ lessonsGenerated: number }> {
    this.state.setMode("learning", `Learning from: ${req.outcome}`);

    let lessons = 0;

    if (req.outcome === "success") {
      await this.selfModel.recordCapabilityOutcome(req.tenantId, req.source, true);
      this.state.updateSuccessRate(true);
      lessons++;
    } else if (req.outcome === "failure") {
      await this.selfModel.recordCapabilityOutcome(req.tenantId, req.source, false);
      await this.failureTaxonomy.classify(
        req.tenantId,
        req.experience,
        "execution" as any,
        "medium" as any,
        req.context,
        { suggestedFix: "retry with alternative approach" },
      );
      this.state.updateSuccessRate(false);
      this.state.recordFailure({ type: "execution", description: req.experience, subsystem: req.source, timestamp: Date.now(), recoveryAttempted: false });
      lessons++;
    }

    if (req.outcome !== "neutral") {
      await this.sharedLearning.shareLesson(
        req.tenantId, req.source, "general",
        req.outcome === "success" ? "technique" : "avoidance",
        `${req.outcome}: ${req.experience.slice(0, 80)}`,
        req.experience, req.context,
      );
      lessons++;
    }

    await this.bus.emit(req.outcome === "success" ? "experience.recorded" : "failure.recorded", "LearningEngine", {
      experience: req.experience.slice(0, 200),
      outcome: req.outcome,
      lessons,
    });

    return { lessonsGenerated: lessons };
  }

  async consolidate(tenantId: string): Promise<{ consolidated: number; patterns: number }> {
    this.state.setMode("consolidating", "Sleep cycle");

    // Real consolidation: use MemoryGraph.consolidate() for duplicate detection and clustering
    let consolidated = 0;
    let patterns = 0;

    // 1. Memory graph consolidation (real: detects duplicates, merges clusters)
    try {
      const report = await (this.experienceCompiler as any).engine?.memoryGraph?.consolidate?.(tenantId, {
        similarityThreshold: 0.85,
        minClusterSize: 2,
        maxClusters: 10,
      });
      if (report) {
        consolidated += (report.mergedCount ?? 0) + (report.deduplicatedCount ?? 0);
      }
    } catch {
      // Non-critical
    }

    // 2. Contradiction detection and resolution
    try {
      const contradictions = await (this.experienceCompiler as any).engine?.memoryGraph?.detectContradictions?.(tenantId);
      if (contradictions && Array.isArray(contradictions)) {
        patterns += contradictions.length;
      }
    } catch {
      // Non-critical
    }

    // 3. Sleep cycle for deeper processing (pattern discovery, skill extraction)
    const sleepResult = await this.sleepCycle.runCycle(tenantId, "deep", {
      consolidateMemory: async () => ({ compressed: consolidated, duplicates: 0 }),
      discoverPatterns: async () => {
        // Real pattern discovery: check SharedLearning for recurring lessons
        const lessons = await this.sharedLearning.getLessons(tenantId);
        const recurring = lessons.filter(l => (l as any).adoptionCount > 2);
        patterns += recurring.length;
        return recurring.length;
      },
      // Deliberately not supplied: neither capability has a real source here.
      // Passing `async () => 0` made the cycle report "0 contradictions
      // resolved, 0 skills extracted" — indistinguishable from having looked.
      // Omitting them reports `null`, which is the truth.

      generateHypotheses: async () => [],
    });

    consolidated += sleepResult.memoriesConsolidated ?? 0;
    patterns += sleepResult.patternsDiscovered ?? 0;

    await this.bus.emit("memory.consolidated", "LearningEngine", { consolidated, patterns });

    return { consolidated, patterns };
  }

  getStats() {
    return { status: "active" };
  }

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Engine-level service"], details: {} };
  }
}


// ─────────────────────────────────────────────
// 6. ATTENTION ENGINE
// ─────────────────────────────────────────────

export interface AttentionTarget {
  id: string;
  category: string;
  title: string;
  urgency: number;
  importance: number;
  salience: number;
}

export class AttentionEngine {
  constructor(
    private attentionV2: AttentionV2Service,
    private workspace: CognitiveWorkspaceService,
    private resources: ResourceIntelligenceService,
    private bus: EventBus,
    private state: CognitiveState,
  ) {}

  async getFocusTargets(tenantId: string, limit: number = 5): Promise<AttentionTarget[]> {
    const targets = await this.attentionV2.getTopTargets(tenantId, limit);
    return targets.map(t => ({
      id: t.id,
      category: t.category,
      title: t.title,
      urgency: t.urgency,
      importance: t.importance,
      salience: t.urgency * 0.6 + t.importance * 0.4,
    }));
  }

  async shiftFocus(tenantId: string, target: { category: string; title: string; urgency: number; importance: number }): Promise<void> {
    const registered = await this.attentionV2.registerTarget(
      tenantId, target.category as any, target.title, target.title, target.urgency, target.importance,
    );

    this.state.setAttentionFocus({
      category: target.category,
      target: target.title,
      urgency: target.urgency,
      importance: target.importance,
      since: Date.now(),
    });

    await this.bus.emit("attention.shifted", "AttentionEngine", { targetId: registered.id, category: target.category });
  }

  getStats() {
    return { status: "active" };
  }

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Engine-level service"], details: {} };
  }
}


// ─────────────────────────────────────────────
// 7. MODEL SELECTION ENGINE
// ─────────────────────────────────────────────

export interface ModelSelectionRequest {
  taskDescription: string;
  strategy: "performance" | "cost" | "quality" | "balanced";
  tenantId: string;
}

export interface ModelSelectionResult {
  selectedModel: string;
  reason: string;
  latencyMs: number;
  alternatives: Array<{ model: string; score: number }>;
}

export class ModelSelectionEngine {
  constructor(
    private modelRouter: ModelRouter,
    private adaptiveRouter: AdaptiveRouterService,
    private benchmark: import("./benchmark-lab.js").BenchmarkLabService,
    private bus: EventBus,
    private state: CognitiveState,
  ) {}

  async select(req: ModelSelectionRequest): Promise<ModelSelectionResult> {
    // Get available models from ModelRouter registry (not hardcoded)
    const registeredModels = this.modelRouter.list();

    // Build available paths from registered providers
    const availablePaths = registeredModels.map((modelId, idx) => ({
      path: modelId,
      latencyMs: 1000 + idx * 500,  // Initial estimate; AdaptiveRouter learns real values
      cost: 0.001 / (idx + 1),
      reliability: 0.9,
    }));

    // Fallback if no models registered
    if (availablePaths.length === 0) {
      availablePaths.push(
        { path: "default", latencyMs: 2000, cost: 0.001, reliability: 0.85 },
      );
    }

    const decision = await this.adaptiveRouter.route(
      req.tenantId,
      `sel-${Date.now()}`,
      req.taskDescription,
      availablePaths,
      req.strategy,
    );

    return {
      selectedModel: decision.selectedPath,
      reason: `Selected by ${req.strategy} strategy from ${registeredModels.length} registered providers`,
      latencyMs: decision.latencyMs,
      alternatives: decision.alternatives.map(a => ({ model: a.path, score: a.score })),
    };
  }

  getStats() {
    return { status: "active" };
  }

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Engine-level service"], details: {} };
  }
}

