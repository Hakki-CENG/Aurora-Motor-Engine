import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { auroraRound, DurableJsonState } from "../util/aurora-state.js";

type SelfModelGoalState = "active" | "achieved" | "blocked" | "abandoned" | "superseded";
type BeliefSource = "observation" | "inference" | "user" | "memory" | "world-model" | "experiment";
type CapabilityLevel = "proficient" | "competent" | "novice" | "incapable" | "unknown";
type StrategyType = "direct" | "exploratory" | "decompose" | "delegate" | "simulate" | "fallback";

interface SelfGoal { id: string; tenantId: string; title: string; description: string; state: SelfModelGoalState; priority: number; parentId?: string; createdAt: string; updatedAt: string; }
interface Belief { id: string; tenantId: string; claim: string; confidence: number; source: BeliefSource; evidenceCount: number; lastConfirmedAt?: string; contradictedBy: string[]; tags: string[]; createdAt: string; updatedAt: string; }
interface CapabilityAssessment { id: string; tenantId: string; domain: string; level: CapabilityLevel; confidence: number; successCount: number; failureCount: number; lastAttemptAt?: string; notes: string; updatedAt: string; }
interface ActiveHypothesis { id: string; tenantId: string; statement: string; confidence: number; supportingEvidence: string[]; contradictingEvidence: string[]; status: "proposed" | "testing" | "confirmed" | "refuted" | "abandoned"; createdAt: string; updatedAt: string; }
interface FailureRecord { id: string; tenantId: string; taskDescription: string; failureType: string; rootCause: string; capabilityGap?: string; strategyUsed: string; alternativeStrategies: string[]; lesson: string; confidence: number; occurredAt: string; }
interface StrategyInfo { type: StrategyType; description: string; confidence: number; startedAt: string; }
interface ResourceInfo { tokenBudget: number; tokensUsed: number; timeBudgetMs: number; timeUsedMs: number; parallelCapacity: number; activeAgents: number; updatedAt: string; }
interface MetacogInfo { lastReflectionAt?: string; reflectionCount: number; selfCorrectionCount: number; strategySwitchCount: number; adaptationRate: number; }

interface SelfModelStateShape {
  schemaVersion: number;
  goals: SelfGoal[];
  beliefs: Belief[];
  capabilities: CapabilityAssessment[];
  hypotheses: ActiveHypothesis[];
  failures: FailureRecord[];
  strategy: StrategyInfo;
  resources: ResourceInfo;
  metacog: MetacogInfo;
  knownStrengths: string[];
  knownWeaknesses: string[];
  currentFocus: string;
}

export class SelfModelService {
  private store: DurableJsonState<SelfModelStateShape>;

  constructor(private baseDir: string) {
    this.store = new DurableJsonState<SelfModelStateShape>(
      join(baseDir, "self-model.json"),
      () => ({
        schemaVersion: 1, goals: [], beliefs: [], capabilities: [], hypotheses: [], failures: [],
        strategy: { type: "direct", description: "default", confidence: 0.5, startedAt: new Date().toISOString() },
        resources: { tokenBudget: 0, tokensUsed: 0, timeBudgetMs: 0, timeUsedMs: 0, parallelCapacity: 5, activeAgents: 0, updatedAt: new Date().toISOString() },
        metacog: { reflectionCount: 0, selfCorrectionCount: 0, strategySwitchCount: 0, adaptationRate: 0 },
        knownStrengths: [], knownWeaknesses: [], currentFocus: "general",
      }),
      (v) => { const s = v as SelfModelStateShape; return !!s && s.schemaVersion === 1; },
      "Aurora self-model state",
    );
  }

  async init(): Promise<void> { await this.store.read(); }

  // ─── Goals ───
  async addGoal(tenantId: string, title: string, description: string, priority: number = 5, parentId?: string): Promise<SelfGoal> {
    const goal: SelfGoal = { id: randomUUID(), tenantId, title, description, state: "active", priority, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...(parentId ? { parentId } : {}) };
    await this.store.mutate(s => { s.goals.push(goal); });
    return goal;
  }

  async updateGoal(goalId: string, patch: Partial<SelfGoal>): Promise<SelfGoal | undefined> {
    return await this.store.mutate(s => {
      const g = s.goals.find(x => x.id === goalId);
      if (g) Object.assign(g, patch, { updatedAt: new Date().toISOString() });
      return g;
    });
  }

  async getGoals(tenantId: string, state?: SelfModelGoalState): Promise<SelfGoal[]> {
    const s = await this.store.read();
    return s.goals.filter(g => g.tenantId === tenantId && (!state || g.state === state)).sort((a, b) => b.priority - a.priority);
  }

  // ─── Beliefs ───
  async addBelief(tenantId: string, claim: string, confidence: number, source: BeliefSource, tags: string[] = []): Promise<Belief> {
    const belief: Belief = { id: randomUUID(), tenantId, claim, confidence: auroraRound(confidence), source, evidenceCount: 1, tags, contradictedBy: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await this.store.mutate(s => { s.beliefs.push(belief); });
    return belief;
  }

  async reinforceBelief(beliefId: string, newConfidence?: number): Promise<void> {
    await this.store.mutate(s => {
      const b = s.beliefs.find(x => x.id === beliefId);
      if (!b) return;
      b.evidenceCount++;
      if (newConfidence !== undefined) b.confidence = auroraRound(newConfidence);
      b.lastConfirmedAt = new Date().toISOString();
      b.updatedAt = new Date().toISOString();
    });
  }

  async contradictBelief(beliefId: string, evidence: string): Promise<void> {
    await this.store.mutate(s => {
      const b = s.beliefs.find(x => x.id === beliefId);
      if (!b) return;
      b.contradictedBy.push(evidence);
      b.confidence = auroraRound(Math.max(0, b.confidence - 0.15));
      b.updatedAt = new Date().toISOString();
    });
  }

  async getBeliefs(tenantId: string, minConfidence: number = 0): Promise<Belief[]> {
    const s = await this.store.read();
    return s.beliefs.filter(b => b.tenantId === tenantId && b.confidence >= minConfidence);
  }

  // ─── Capabilities ───
  async assessCapability(tenantId: string, domain: string, level: CapabilityLevel, notes: string = ""): Promise<CapabilityAssessment> {
    return await this.store.mutate(s => {
      const existing = s.capabilities.find(c => c.tenantId === tenantId && c.domain === domain);
      if (existing) { existing.level = level; existing.notes = notes; existing.updatedAt = new Date().toISOString(); return existing; }
      const cap: CapabilityAssessment = { id: randomUUID(), tenantId, domain, level, confidence: 0.5, successCount: 0, failureCount: 0, notes, updatedAt: new Date().toISOString() };
      s.capabilities.push(cap);
      return cap;
    });
  }

  async recordCapabilityOutcome(tenantId: string, domain: string, success: boolean): Promise<void> {
    await this.store.mutate(s => {
      const c = s.capabilities.find(x => x.tenantId === tenantId && x.domain === domain);
      if (!c) return;
      if (success) { c.successCount++; c.confidence = auroraRound(Math.min(1, c.confidence + 0.05)); }
      else { c.failureCount++; c.confidence = auroraRound(Math.max(0, c.confidence - 0.1)); }
      c.lastAttemptAt = new Date().toISOString();
      c.updatedAt = new Date().toISOString();
    });
  }

  async getCapabilities(tenantId: string): Promise<CapabilityAssessment[]> {
    const s = await this.store.read();
    return s.capabilities.filter(c => c.tenantId === tenantId);
  }

  // ─── Hypotheses ───
  async proposeHypothesis(tenantId: string, statement: string, confidence: number): Promise<ActiveHypothesis> {
    const h: ActiveHypothesis = { id: randomUUID(), tenantId, statement, confidence: auroraRound(confidence), supportingEvidence: [], contradictingEvidence: [], status: "proposed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await this.store.mutate(s => { s.hypotheses.push(h); });
    return h;
  }

  async updateHypothesis(hypId: string, patch: Partial<ActiveHypothesis>): Promise<void> {
    await this.store.mutate(s => {
      const h = s.hypotheses.find(x => x.id === hypId);
      if (h) Object.assign(h, patch, { updatedAt: new Date().toISOString() });
    });
  }

  async getHypotheses(tenantId: string, status?: string): Promise<ActiveHypothesis[]> {
    const s = await this.store.read();
    return s.hypotheses.filter(h => h.tenantId === tenantId && (!status || h.status === status));
  }

  // ─── Failures ───
  async recordFailure(tenantId: string, taskDescription: string, failureType: string, rootCause: string, strategyUsed: string, lesson: string, capabilityGap?: string): Promise<FailureRecord> {
    const record: FailureRecord = { id: randomUUID(), tenantId, taskDescription, failureType, rootCause, strategyUsed, alternativeStrategies: [], lesson, confidence: 0.7, occurredAt: new Date().toISOString(), ...(capabilityGap ? { capabilityGap } : {}) };
    await this.store.mutate(s => { s.failures.push(record); if (s.failures.length > 5000) s.failures.splice(0, s.failures.length - 5000); });
    return record;
  }

  async getFailurePatterns(tenantId: string): Promise<Array<{ type: string; count: number; commonCause: string }>> {
    const s = await this.store.read();
    const byType = new Map<string, FailureRecord[]>();
    for (const f of s.failures.filter(x => x.tenantId === tenantId)) { const arr = byType.get(f.failureType) ?? []; arr.push(f); byType.set(f.failureType, arr); }
    return [...byType.entries()].map(([type, records]) => ({ type, count: records.length, commonCause: records[records.length - 1]?.rootCause ?? "unknown" })).sort((a, b) => b.count - a.count);
  }

  // ─── Strategy ───
  async switchStrategy(type: StrategyType, description: string, confidence: number): Promise<void> {
    await this.store.mutate(s => {
      s.strategy = { type, description, confidence: auroraRound(confidence), startedAt: new Date().toISOString() };
      s.metacog.strategySwitchCount++;
    });
  }

  async updateResources(patch: Partial<ResourceInfo>): Promise<void> {
    await this.store.mutate(s => { Object.assign(s.resources, patch, { updatedAt: new Date().toISOString() }); });
  }

  async reflect(): Promise<{ insights: string[]; corrections: number }> {
    return await this.store.mutate(s => {
      s.metacog.lastReflectionAt = new Date().toISOString();
      s.metacog.reflectionCount++;
      const insights: string[] = [];
      const byType = new Map<string, number>();
      for (const f of s.failures.filter(x => x.tenantId === "local")) byType.set(f.failureType, (byType.get(f.failureType) ?? 0) + 1);
      const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) insights.push(`Most common failure: ${top[0]} (${top[1]} times)`);
      const weakCaps = s.capabilities.filter(c => c.confidence < 0.3);
      if (weakCaps.length > 0) insights.push(`${weakCaps.length} capability area(s) below 30% confidence`);
      s.metacog.adaptationRate = auroraRound(s.metacog.selfCorrectionCount / Math.max(1, s.metacog.reflectionCount));
      return { insights, corrections: s.metacog.selfCorrectionCount };
    });
  }

  async getFullState(tenantId: string) {
    const s = await this.store.read();
    return {
      strategy: s.strategy, resources: s.resources, metacog: s.metacog,
      goals: s.goals.filter(g => g.tenantId === tenantId),
      beliefs: s.beliefs.filter(b => b.tenantId === tenantId),
      capabilities: s.capabilities.filter(c => c.tenantId === tenantId),
      hypotheses: s.hypotheses.filter(h => h.tenantId === tenantId),
    };
  }

  // ═══ P1-35: Capability Awareness ═══

  async getCapabilityAwareness(tenantId: string): Promise<{
    strong: Array<{ domain: string; confidence: number; successRate: number }>;
    moderate: Array<{ domain: string; confidence: number; successRate: number }>;
    weak: Array<{ domain: string; confidence: number; successRate: number }>;
    unknown: Array<{ domain: string; confidence: number; successRate: number }>;
  }> {
    const s = await this.store.read();
    const caps = s.capabilities.filter(c => c.tenantId === tenantId);
    const categorize = (min: number, max: number) =>
      caps.filter(c => c.confidence >= min && c.confidence < max)
        .map(c => ({
          domain: c.domain, confidence: c.confidence,
          successRate: c.successCount + c.failureCount > 0 ? c.successCount / (c.successCount + c.failureCount) : 0,
        }))
        .sort((a, b) => b.confidence - a.confidence);
    return { strong: categorize(0.8, 1.01), moderate: categorize(0.5, 0.8), weak: categorize(0.2, 0.5), unknown: categorize(0, 0.2) };
  }

  // ═══ P1-38: Capability Gap Detector ═══

  async detectCapabilityGaps(tenantId: string): Promise<Array<{
    domain: string;
    gapType: "failure" | "weak" | "missing" | "correction";
    severity: "low" | "medium" | "high" | "critical";
    evidence: string;
    suggestedAction: string;
    failureCount: number;
    currentConfidence: number;
  }>> {
    const s = await this.store.read();
    const gaps: Array<{ domain: string; gapType: "failure" | "weak" | "missing" | "correction"; severity: "low" | "medium" | "high" | "critical"; evidence: string; suggestedAction: string; failureCount: number; currentConfidence: number }> = [];
    const caps = s.capabilities.filter(c => c.tenantId === tenantId);
    const failures = s.failures.filter(f => f.tenantId === tenantId);

    for (const cap of caps) {
      const total = cap.successCount + cap.failureCount;
      if (total < 3) continue;
      const failRate = cap.failureCount / total;
      if (failRate > 0.5) {
        gaps.push({ domain: cap.domain, gapType: "failure", severity: failRate > 0.8 ? "critical" : failRate > 0.6 ? "high" : "medium", evidence: `${cap.failureCount}/${total} failures`, suggestedAction: `Practice with simpler tasks or delegate`, failureCount: cap.failureCount, currentConfidence: cap.confidence });
      }
    }
    for (const cap of caps) {
      if (cap.confidence < 0.3 && cap.successCount + cap.failureCount >= 2) {
        gaps.push({ domain: cap.domain, gapType: "weak", severity: cap.confidence < 0.1 ? "critical" : "medium", evidence: `Confidence: ${(cap.confidence * 100).toFixed(0)}%`, suggestedAction: `Seek training or use reference tools`, failureCount: cap.failureCount, currentConfidence: cap.confidence });
      }
    }
    const failureByType = new Map<string, number>();
    for (const f of failures) failureByType.set(f.failureType, (failureByType.get(f.failureType) ?? 0) + 1);
    for (const [type, count] of failureByType) {
      if (count >= 3) gaps.push({ domain: type, gapType: "failure", severity: count >= 5 ? "high" : "medium", evidence: `${count} failures of type "${type}"`, suggestedAction: `Analyze root cause and create specialized skill`, failureCount: count, currentConfidence: 0 });
    }

    return gaps.sort((a, b) => { const sev: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }; return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0); });
  }

  // ═══ P2: Proactive Intelligence ═══

  async anticipateNeeds(tenantId: string): Promise<{
suggestions: Array<{ type: string; priority: number; description: string; rationale: string }>;
    risks: Array<{ type: string; severity: string; description: string }>;
    opportunities: Array<{ description: string; confidence: number }>;
    }> {
    const s = await this.store.read();
    const goals = s.goals.filter(g => g.tenantId === tenantId);
    const beliefs = s.beliefs.filter(b => b.tenantId === tenantId);
    const capabilities = s.capabilities.filter(c => c.tenantId === tenantId);
    const failures = s.failures.filter(f => f.tenantId === tenantId);
    const hypotheses = s.hypotheses.filter(h => h.tenantId === tenantId);

    const suggestions: Array<{ type: string; priority: number; description: string; rationale: string }> = [];
    const risks: Array<{ type: string; severity: string; description: string }> = [];
    const opportunities: Array<{ description: string; confidence: number }> = [];

    // Analyze stalled goals
    for (const g of goals.filter(g => g.state === "active")) {
      suggestions.push({ type: "goal_progress", priority: g.priority, description: `Work on: ${g.title}`, rationale: "Active goal needs attention" });
    }

    // Analyze weak capabilities
    for (const c of capabilities.filter(c => c.level === "novice")) {
      risks.push({ type: "capability_gap", severity: "medium", description: `Weak capability in ${c.domain} — may fail similar tasks` });
      suggestions.push({ type: "capability_improvement", priority: 6, description: `Improve ${c.domain} capability`, rationale: `Current level: ${c.level}` });
    }

    // Analyze failure patterns
    for (const f of failures) {
      risks.push({ type: "recurring_failure", severity: "high", description: `Recurring ${f.failureType} failures — root cause: ${f.rootCause}` });
    }

    // Analyze low-confidence beliefs
    for (const b of beliefs.filter(b => b.confidence < 0.3)) {
      risks.push({ type: "uncertain_belief", severity: "low", description: `Low confidence belief: ${b.claim} (${(b.confidence * 100).toFixed(0)}%)` });
    }

    // Analyze untested hypotheses
    for (const h of hypotheses.filter(h => h.status === "proposed")) {
      opportunities.push({ description: `Test hypothesis: ${h.statement}`, confidence: h.confidence });
    }

    // Sort by priority
    suggestions.sort((a, b) => b.priority - a.priority);

    return { suggestions: suggestions.slice(0, 10), risks: risks.slice(0, 10), opportunities: opportunities.slice(0, 10) };
  }

  async getStats(tenantId: string) {
    const s = await this.store.read();
    const pf = (s as any).goals?.filter((x: any) => x.tenantId === tenantId) ?? [];
    const sf = (s as any).beliefs?.filter((x: any) => x.tenantId === tenantId) ?? [];
    return { totalPrimary: pf.length, totalSecondary: sf.length };
  }

  // ═══ P2: Explainability ═══

  async why(tenantId: string, entityId: string): Promise<{
entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
    }> {
    const s = await this.store.read();
    const keys = Object.keys(s);
    const arrayKey = keys.find(k => Array.isArray((s as any)[k]));
    const items: any[] = arrayKey ? ((s as any)[arrayKey] as any[]).filter((x: any) => x.tenantId === tenantId) : [];
    const entity = items.find((x: any) => x.id === entityId);
    if (!entity) throw new Error("Entity not found");
    const rationale: string[] = [`Found entity: ${entity.name ?? entity.title ?? entity.id ?? entityId}`];
    return { entity: entity.name ?? entity.title ?? entityId, summary: entity.description ?? entity.statement ?? "", rationale, details: entity };
  }
}
