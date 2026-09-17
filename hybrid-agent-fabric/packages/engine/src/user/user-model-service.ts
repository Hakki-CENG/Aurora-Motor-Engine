import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  auroraIds, auroraInteger, auroraRound, auroraText, auroraTimestamp, auroraUnit, DurableJsonState,
} from "../util/aurora-state.js";

const MAX_CLAIMS = 50_000;
const MAX_GOALS = 5_000;
const MAX_SIGNALS = 20_000;
const MAX_MILESTONES = 5_000;
const MAX_ADVICE = 50_000;

/**
 * Behavioural categories only. The PDF is explicit that this is a behaviour/goal/habit twin,
 * not an identity, personality or belief profile — the forbidden-topic guard below enforces that.
 */
export type UserClaimCategory =
  | "identity-context" | "goal" | "motivation" | "decision-style" | "learning-style" | "strength"
  | "weakness" | "habit" | "productivity" | "energy" | "attention" | "frustration"
  | "communication" | "trust" | "interest" | "project" | "tooling";

export type UserClaimStatus = "proposed" | "active" | "corrected" | "retracted" | "expired";
export type UserClaimSource = "user-stated" | "inferred" | "system";

export interface UserClaim {
  id: string;
  tenantId: string;
  userId: string;
  category: UserClaimCategory;
  key: string;
  value: string;
  confidence: number;
  source: UserClaimSource;
  status: UserClaimStatus;
  consent: "granted" | "pending" | "denied";
  evidenceRefs: string[];
  observations: number;
  correctionHistory: Array<{ previousValue: string; correctedValue: string; correctedBy: "user" | "system"; reason: string; at: string }>;
  validFrom: string;
  expiresAt?: string;
  lastConfirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserGoalModel {
  id: string;
  tenantId: string;
  userId: string;
  horizon: "long" | "medium" | "short";
  title: string;
  description: string;
  parentGoalId?: string;
  progress: number;
  importance: number;
  status: "active" | "paused" | "achieved" | "abandoned";
  lastProgressAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSignal {
  id: string;
  tenantId: string;
  userId: string;
  kind: "activity" | "idle" | "message" | "commit" | "research" | "error" | "break";
  intensity: number;
  at: string;
  note?: string;
}

export interface UserMilestone {
  id: string;
  tenantId: string;
  userId: string;
  kind: "decision" | "success" | "failure" | "turning-point" | "start";
  title: string;
  summary: string;
  importance: number;
  occurredAt: string;
  createdAt: string;
}

export interface AdviceRecord {
  id: string;
  tenantId: string;
  userId: string;
  summary: string;
  initiativeId?: string;
  claimRefs: string[];
  outcome?: { followed: boolean; helpful: boolean; note?: string; ratedAt: string };
  createdAt: string;
}

export interface UserStateEstimate {
  userId: string;
  state: "working" | "researching" | "resting" | "busy" | "idle" | "unknown";
  confidence: number;
  uncertainty: number;
  basis: string[];
  isEstimate: true;
  generatedAt: string;
}

export interface UserModelSummary {
  userId: string;
  tenantId: string;
  claims: Record<string, Array<{ key: string; value: string; confidence: number; source: UserClaimSource; status: UserClaimStatus }>>;
  goals: UserGoalModel[];
  trustScore: number;
  adviceEffectiveness: { total: number; followed: number; helpful: number; score: number };
  frustrationRisk: number;
  attentionLoad: number;
  generatedAt: string;
}

interface UserModelStateShape {
  schemaVersion: 1;
  claims: UserClaim[];
  goals: UserGoalModel[];
  signals: UserSignal[];
  milestones: UserMilestone[];
  advice: AdviceRecord[];
}

/** Constitutional privacy guard: Aurora may model behaviour, never these protected topics. */
const FORBIDDEN_TOPIC_PATTERNS = [
  /\b(health|illness|disease|diagnosis|medication|mental[- ]?health|depress\w*|hastalık|ilaç|teşhis)\b/i,
  /\b(religion|religious|faith|belief system|din|dini|inanç|ibadet)\b/i,
  /\b(politic\w*|party|vote[sd]?|ideolog\w*|siyas\w*|parti|oy verme)\b/i,
  /\b(ethnic\w*|race|racial|nationalit\w*|etnik|ırk)\b/i,
  /\b(sexual\w*|orientation|gender identity|cinsel)\b/i,
  /\b(salary|income|bank account|credit card|password|maaş|gelir|şifre|kredi kartı)\b/i,
];

/**
 * Aurora Phase E — governed user cognitive model.
 *
 * Every inference about the user is a typed, confidence-scored, evidence-backed, inspectable claim
 * that the user can correct, retract or delete. Inferred claims start as `proposed` and never
 * silently become facts. Protected topics are rejected at write time.
 */
export class UserModelService {
  private readonly store: DurableJsonState<UserModelStateShape>;

  constructor(rootPath: string, private readonly now: () => number = Date.now) {
    this.store = new DurableJsonState<UserModelStateShape>(
      join(rootPath, "user-model", "state.json"),
      () => ({ schemaVersion: 1, claims: [], goals: [], signals: [], milestones: [], advice: [] }),
      (value) => {
        const state = value as UserModelStateShape;
        return !!state && state.schemaVersion === 1 && Array.isArray(state.claims) && Array.isArray(state.goals)
          && Array.isArray(state.signals) && Array.isArray(state.milestones) && Array.isArray(state.advice);
      },
      "Aurora user model",
    );
  }

  /**
   * Record or reinforce a behavioural claim. User-stated claims are active immediately;
   * inferred claims stay `proposed` until they are confirmed or explicitly promoted.
   */
  async observeClaim(input: {
    tenantId: string; userId: string; category: UserClaimCategory; key: string; value: string;
    confidence: number; source: UserClaimSource; evidenceRefs?: string[]; expiresAt?: string;
  }): Promise<UserClaim> {
    return await this.store.mutate((state) => {
      if (state.claims.length >= MAX_CLAIMS) throw new Error("User claim limit reached.");
      const key = auroraText(input.key, 200, "User claim key").toLowerCase();
      const value = auroraText(input.value, 5000, "User claim value");
      assertPermittedTopic(`${input.category} ${key} ${value}`);
      const timestamp = this.now();
      const nowIso = new Date(timestamp).toISOString();
      const existing = state.claims.find((item) => item.tenantId === input.tenantId && item.userId === input.userId
        && item.category === input.category && item.key === key && ["proposed", "active"].includes(item.status));
      if (existing) {
        if (existing.value === value) {
          existing.observations++;
          existing.confidence = auroraRound(Math.min(1, (existing.confidence * (existing.observations - 1) + auroraUnit(input.confidence, "Claim confidence")) / existing.observations + 0.02));
          existing.lastConfirmedAt = nowIso;
          if (existing.status === "proposed" && (input.source === "user-stated" || existing.observations >= 3)) existing.status = "active";
        } else {
          existing.correctionHistory.push({ previousValue: existing.value, correctedValue: value, correctedBy: "system", reason: "New observation replaced the previous value.", at: nowIso });
          existing.value = value;
          existing.confidence = auroraUnit(input.confidence, "Claim confidence");
          existing.observations = 1;
          existing.status = input.source === "user-stated" ? "active" : "proposed";
        }
        existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...auroraIds(input.evidenceRefs, 200, "Claim evidence refs")])].slice(0, 200);
        existing.source = input.source;
        existing.updatedAt = nowIso;
        return structuredClone(existing);
      }
      const claim: UserClaim = {
        id: `claim-${randomUUID()}`,
        tenantId: input.tenantId,
        userId: auroraText(input.userId, 200, "User ID"),
        category: input.category,
        key,
        value,
        confidence: auroraUnit(input.confidence, "Claim confidence"),
        source: input.source,
        status: input.source === "user-stated" ? "active" : "proposed",
        consent: input.source === "user-stated" ? "granted" : "pending",
        evidenceRefs: auroraIds(input.evidenceRefs, 200, "Claim evidence refs"),
        observations: 1,
        correctionHistory: [],
        validFrom: nowIso,
        ...(input.expiresAt ? { expiresAt: auroraTimestamp(input.expiresAt, timestamp, "Claim expiry") } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      state.claims.push(claim);
      return structuredClone(claim);
    });
  }

  /** The user grants or denies consent for an inferred claim; denial retracts it immediately. */
  async setConsent(tenantId: string, claimId: string, consent: UserClaim["consent"]): Promise<UserClaim> {
    return await this.store.mutate((state) => {
      const claim = this.mutableClaim(state, tenantId, claimId);
      claim.consent = consent;
      if (consent === "granted" && claim.status === "proposed") claim.status = "active";
      if (consent === "denied") claim.status = "retracted";
      claim.updatedAt = new Date(this.now()).toISOString();
      return structuredClone(claim);
    });
  }

  /** The user corrects Aurora. The previous value is kept in history so the mistake is auditable. */
  async correctClaim(input: { tenantId: string; claimId: string; correctedValue: string; reason: string; confidence?: number }): Promise<UserClaim> {
    return await this.store.mutate((state) => {
      const claim = this.mutableClaim(state, input.tenantId, input.claimId);
      const corrected = auroraText(input.correctedValue, 5000, "Corrected value");
      assertPermittedTopic(corrected);
      const nowIso = new Date(this.now()).toISOString();
      claim.correctionHistory.push({
        previousValue: claim.value,
        correctedValue: corrected,
        correctedBy: "user",
        reason: auroraText(input.reason, 2000, "Correction reason"),
        at: nowIso,
      });
      claim.value = corrected;
      claim.confidence = input.confidence === undefined ? 0.95 : auroraUnit(input.confidence, "Corrected confidence");
      claim.source = "user-stated";
      claim.status = "active";
      claim.consent = "granted";
      claim.observations = 1;
      claim.updatedAt = nowIso;
      return structuredClone(claim);
    });
  }

  async retractClaim(tenantId: string, claimId: string, reason: string): Promise<UserClaim> {
    return await this.store.mutate((state) => {
      const claim = this.mutableClaim(state, tenantId, claimId);
      claim.status = "retracted";
      claim.correctionHistory.push({ previousValue: claim.value, correctedValue: "", correctedBy: "user", reason: auroraText(reason, 2000, "Retraction reason"), at: new Date(this.now()).toISOString() });
      claim.updatedAt = new Date(this.now()).toISOString();
      return structuredClone(claim);
    });
  }

  /** Right to be forgotten: delete every stored inference about a user (optionally one category). */
  async forgetUser(tenantId: string, userId: string, category?: UserClaimCategory): Promise<{ removedClaims: number; removedGoals: number; removedSignals: number; removedMilestones: number; removedAdvice: number }> {
    return await this.store.mutate((state) => {
      const before = {
        claims: state.claims.length,
        goals: state.goals.length,
        signals: state.signals.length,
        milestones: state.milestones.length,
        advice: state.advice.length,
      };
      const matchesUser = (item: { tenantId: string; userId: string }) => item.tenantId === tenantId && item.userId === userId;
      state.claims = state.claims.filter((item) => !(matchesUser(item) && (!category || item.category === category)));
      if (!category) {
        state.goals = state.goals.filter((item) => !matchesUser(item));
        state.signals = state.signals.filter((item) => !matchesUser(item));
        state.milestones = state.milestones.filter((item) => !matchesUser(item));
        state.advice = state.advice.filter((item) => !matchesUser(item));
      }
      return {
        removedClaims: before.claims - state.claims.length,
        removedGoals: before.goals - state.goals.length,
        removedSignals: before.signals - state.signals.length,
        removedMilestones: before.milestones - state.milestones.length,
        removedAdvice: before.advice - state.advice.length,
      };
    });
  }

  async claims(tenantId: string, userId: string, filter?: { category?: UserClaimCategory; status?: UserClaimStatus }): Promise<UserClaim[]> {
    const state = await this.store.read();
    return state.claims
      .filter((item) => item.tenantId === tenantId && item.userId === userId
        && (!filter?.category || item.category === filter.category)
        && (!filter?.status || item.status === filter.status))
      .sort((a, b) => b.confidence - a.confidence)
      .map((item) => structuredClone(item));
  }

  async upsertGoal(input: {
    tenantId: string; userId: string; horizon: UserGoalModel["horizon"]; title: string; description?: string;
    parentGoalId?: string; importance?: number; goalId?: string; progress?: number; status?: UserGoalModel["status"];
  }): Promise<UserGoalModel> {
    return await this.store.mutate((state) => {
      const nowIso = new Date(this.now()).toISOString();
      if (input.goalId) {
        const goal = state.goals.find((item) => item.tenantId === input.tenantId && item.id === input.goalId);
        if (!goal) throw new Error("User goal not found in tenant.");
        if (input.progress !== undefined) {
          goal.progress = auroraUnit(input.progress, "Goal progress");
          goal.lastProgressAt = nowIso;
        }
        if (input.status) goal.status = input.status;
        if (input.importance !== undefined) goal.importance = auroraUnit(input.importance, "Goal importance");
        if (input.description) goal.description = auroraText(input.description, 10_000, "Goal description");
        goal.updatedAt = nowIso;
        return structuredClone(goal);
      }
      if (state.goals.length >= MAX_GOALS) throw new Error("User goal limit reached.");
      if (input.parentGoalId && !state.goals.some((item) => item.tenantId === input.tenantId && item.id === input.parentGoalId)) throw new Error("Parent user goal not found.");
      const goal: UserGoalModel = {
        id: `ugoal-${randomUUID()}`,
        tenantId: input.tenantId,
        userId: auroraText(input.userId, 200, "User ID"),
        horizon: input.horizon,
        title: auroraText(input.title, 300, "Goal title"),
        description: input.description ? auroraText(input.description, 10_000, "Goal description") : "",
        ...(input.parentGoalId ? { parentGoalId: input.parentGoalId } : {}),
        progress: auroraUnit(input.progress ?? 0, "Goal progress"),
        importance: auroraUnit(input.importance ?? 0.6, "Goal importance"),
        status: "active",
        lastProgressAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      state.goals.push(goal);
      return structuredClone(goal);
    });
  }

  async goals(tenantId: string, userId: string, status?: UserGoalModel["status"]): Promise<UserGoalModel[]> {
    const state = await this.store.read();
    const order = { long: 0, medium: 1, short: 2 } as const;
    return state.goals
      .filter((item) => item.tenantId === tenantId && item.userId === userId && (!status || item.status === status))
      .sort((a, b) => order[a.horizon] - order[b.horizon] || b.importance - a.importance)
      .map((item) => structuredClone(item));
  }

  /** Goals with no progress for a while — the input for stalled-progress interventions. */
  async stalledGoals(tenantId: string, userId: string, days = 14): Promise<UserGoalModel[]> {
    const state = await this.store.read();
    const threshold = this.now() - auroraInteger(days, 1, 365, "Stall window") * 86_400_000;
    return state.goals
      .filter((item) => item.tenantId === tenantId && item.userId === userId && item.status === "active" && Date.parse(item.lastProgressAt) < threshold)
      .map((item) => structuredClone(item));
  }

  async recordSignal(input: { tenantId: string; userId: string; kind: UserSignal["kind"]; intensity: number; at?: string; note?: string }): Promise<UserSignal> {
    return await this.store.mutate((state) => {
      const tenantSignals = state.signals.filter((item) => item.tenantId === input.tenantId);
      if (tenantSignals.length >= MAX_SIGNALS) {
        const oldest = tenantSignals.sort((a, b) => a.at.localeCompare(b.at)).slice(0, Math.ceil(MAX_SIGNALS * 0.1)).map((item) => item.id);
        state.signals = state.signals.filter((item) => !oldest.includes(item.id));
      }
      const signal: UserSignal = {
        id: `signal-${randomUUID()}`,
        tenantId: input.tenantId,
        userId: auroraText(input.userId, 200, "User ID"),
        kind: input.kind,
        intensity: auroraUnit(input.intensity, "Signal intensity"),
        at: auroraTimestamp(input.at, this.now(), "Signal timestamp"),
        ...(input.note ? { note: auroraText(input.note, 1000, "Signal note") } : {}),
      };
      state.signals.push(signal);
      return structuredClone(signal);
    });
  }

  /**
   * Current-state estimator. The result is explicitly labelled as an estimate with uncertainty,
   * because the PDF forbids treating this as ground truth.
   */
  async estimateState(tenantId: string, userId: string): Promise<UserStateEstimate> {
    const state = await this.store.read();
    const timestamp = this.now();
    const recent = state.signals
      .filter((item) => item.tenantId === tenantId && item.userId === userId && timestamp - Date.parse(item.at) <= 4 * 60 * 60_000)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50);
    if (!recent.length) {
      return { userId, state: "unknown", confidence: 0.2, uncertainty: 0.8, basis: ["No recent behavioural signals."], isEstimate: true, generatedAt: new Date(timestamp).toISOString() };
    }
    const weights: Record<UserSignal["kind"], number> = { activity: 0, idle: 0, message: 0, commit: 0, research: 0, error: 0, break: 0 };
    for (const signal of recent) {
      const ageHours = (timestamp - Date.parse(signal.at)) / 3_600_000;
      weights[signal.kind] += signal.intensity * (1 / (1 + ageHours));
    }
    const mapping: Array<{ state: UserStateEstimate["state"]; score: number; because: string }> = ([
      { state: "working", score: weights.commit * 1.2 + weights.activity, because: "commit/activity signals" },
      { state: "researching", score: weights.research * 1.3, because: "research signals" },
      { state: "busy", score: weights.message + weights.error * 1.1, because: "message/error signals" },
      { state: "resting", score: weights.break * 1.4, because: "break signals" },
      { state: "idle", score: weights.idle * 1.2, because: "idle signals" },
    ] satisfies Array<{ state: UserStateEstimate["state"]; score: number; because: string }>).sort((a, b) => b.score - a.score);
    const best = mapping[0]!;
    const total = mapping.reduce((sum, item) => sum + item.score, 0);
    const confidence = total ? auroraRound(Math.min(0.9, best.score / total)) : 0.2;
    return {
      userId,
      state: best.score <= 0 ? "unknown" : best.state,
      confidence,
      uncertainty: auroraRound(1 - confidence),
      basis: [`${recent.length} signals in the last 4h`, `dominant evidence: ${best.because}`],
      isEstimate: true,
      generatedAt: new Date(timestamp).toISOString(),
    };
  }

  /** Frustration detector: repeated errors plus stalled goals in the recent window. */
  async frustrationRisk(tenantId: string, userId: string): Promise<{ risk: number; signals: number; stalledGoals: number; recommendation: string }> {
    const state = await this.store.read();
    const timestamp = this.now();
    const errors = state.signals.filter((item) => item.tenantId === tenantId && item.userId === userId && item.kind === "error" && timestamp - Date.parse(item.at) <= 7 * 86_400_000);
    const stalled = (await this.stalledGoals(tenantId, userId)).length;
    const risk = auroraRound(Math.min(1, errors.length * 0.08 + stalled * 0.15));
    return {
      risk,
      signals: errors.length,
      stalledGoals: stalled,
      recommendation: risk >= 0.6
        ? "Change the approach: decompose the blocked work and reduce proactive noise."
        : risk >= 0.3 ? "Offer one concrete unblocking suggestion, not a list." : "No intervention needed.",
    };
  }

  async addMilestone(input: { tenantId: string; userId: string; kind: UserMilestone["kind"]; title: string; summary: string; importance?: number; occurredAt?: string }): Promise<UserMilestone> {
    return await this.store.mutate((state) => {
      if (state.milestones.length >= MAX_MILESTONES) throw new Error("User milestone limit reached.");
      const milestone: UserMilestone = {
        id: `mile-${randomUUID()}`,
        tenantId: input.tenantId,
        userId: auroraText(input.userId, 200, "User ID"),
        kind: input.kind,
        title: auroraText(input.title, 300, "Milestone title"),
        summary: auroraText(input.summary, 10_000, "Milestone summary"),
        importance: auroraUnit(input.importance ?? 0.6, "Milestone importance"),
        occurredAt: auroraTimestamp(input.occurredAt, this.now(), "Milestone timestamp"),
        createdAt: new Date(this.now()).toISOString(),
      };
      state.milestones.push(milestone);
      return structuredClone(milestone);
    });
  }

  /** Personal growth timeline plus relationship memory. */
  async timeline(tenantId: string, userId: string): Promise<UserMilestone[]> {
    const state = await this.store.read();
    return state.milestones
      .filter((item) => item.tenantId === tenantId && item.userId === userId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((item) => structuredClone(item));
  }

  async recordAdvice(input: { tenantId: string; userId: string; summary: string; initiativeId?: string; claimRefs?: string[] }): Promise<AdviceRecord> {
    return await this.store.mutate((state) => {
      if (state.advice.length >= MAX_ADVICE) throw new Error("Advice record limit reached.");
      const record: AdviceRecord = {
        id: `advice-${randomUUID()}`,
        tenantId: input.tenantId,
        userId: auroraText(input.userId, 200, "User ID"),
        summary: auroraText(input.summary, 10_000, "Advice summary"),
        ...(input.initiativeId ? { initiativeId: input.initiativeId } : {}),
        claimRefs: auroraIds(input.claimRefs, 100, "Advice claim refs"),
        createdAt: new Date(this.now()).toISOString(),
      };
      state.advice.push(record);
      return structuredClone(record);
    });
  }

  /** Advice effectiveness feedback loop; low effectiveness must make Aurora advise less, not more. */
  async recordAdviceOutcome(input: { tenantId: string; adviceId: string; followed: boolean; helpful: boolean; note?: string }): Promise<AdviceRecord> {
    return await this.store.mutate((state) => {
      const record = state.advice.find((item) => item.tenantId === input.tenantId && item.id === input.adviceId);
      if (!record) throw new Error("Advice record not found in tenant.");
      if (record.outcome) throw new Error("Advice outcome is already recorded.");
      record.outcome = {
        followed: input.followed,
        helpful: input.helpful,
        ...(input.note ? { note: auroraText(input.note, 2000, "Advice note") } : {}),
        ratedAt: new Date(this.now()).toISOString(),
      };
      return structuredClone(record);
    });
  }

  /** Guardian alignment check: does a proposed action serve the user's own active goals? */
  async alignmentCheck(tenantId: string, userId: string, proposal: string): Promise<{ aligned: boolean; score: number; supportingGoalIds: string[]; concerns: string[] }> {
    const state = await this.store.read();
    const text = auroraText(proposal, 10_000, "Alignment proposal").toLowerCase();
    const goals = state.goals.filter((item) => item.tenantId === tenantId && item.userId === userId && item.status === "active");
    const supporting = goals.filter((goal) => {
      const tokens = [...new Set(`${goal.title} ${goal.description}`.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/))]
        .filter((token) => token.length > 3)
        .slice(0, 40);
      return tokens.some((token) => text.includes(token));
    });
    const weakness = state.claims.filter((item) => item.tenantId === tenantId && item.userId === userId && item.category === "weakness" && item.status === "active");
    const concerns = weakness.filter((claim) => text.includes(claim.value.toLowerCase().split(/\s+/)[0] ?? "\u0000")).map((claim) => `Known difficulty: ${claim.value}`);
    const score = auroraRound(Math.min(1, supporting.reduce((sum, goal) => sum + goal.importance, 0) / Math.max(1, goals.length)));
    return { aligned: supporting.length > 0, score, supportingGoalIds: supporting.map((item) => item.id), concerns };
  }

  /** Full inspectable projection of everything Aurora believes about a user. */
  async summary(tenantId: string, userId: string): Promise<UserModelSummary> {
    const state = await this.store.read();
    const claims = state.claims.filter((item) => item.tenantId === tenantId && item.userId === userId && ["active", "proposed"].includes(item.status));
    const grouped: UserModelSummary["claims"] = {};
    for (const claim of claims) {
      grouped[claim.category] = [...(grouped[claim.category] ?? []), { key: claim.key, value: claim.value, confidence: claim.confidence, source: claim.source, status: claim.status }];
    }
    const advice = state.advice.filter((item) => item.tenantId === tenantId && item.userId === userId && item.outcome);
    const followed = advice.filter((item) => item.outcome?.followed).length;
    const helpful = advice.filter((item) => item.outcome?.helpful).length;
    const trustClaim = claims.find((item) => item.category === "trust");
    const attentionClaims = claims.filter((item) => item.category === "attention");
    const frustration = await this.frustrationRisk(tenantId, userId);
    return {
      userId,
      tenantId,
      claims: grouped,
      goals: (await this.goals(tenantId, userId, "active")),
      trustScore: trustClaim ? trustClaim.confidence : 0.5,
      adviceEffectiveness: {
        total: advice.length,
        followed,
        helpful,
        score: advice.length ? auroraRound((followed * 0.4 + helpful * 0.6) / advice.length) : 0,
      },
      frustrationRisk: frustration.risk,
      attentionLoad: attentionClaims.length ? auroraRound(attentionClaims.reduce((sum, item) => sum + item.confidence, 0) / attentionClaims.length) : 0.5,
      generatedAt: new Date(this.now()).toISOString(),
    };
  }

  private mutableClaim(state: UserModelStateShape, tenantId: string, claimId: string): UserClaim {
    const claim = state.claims.find((item) => item.tenantId === tenantId && item.id === claimId);
    if (!claim) throw new Error("User claim not found in tenant.");
    return claim;
  }
}

function assertPermittedTopic(text: string): void {
  for (const pattern of FORBIDDEN_TOPIC_PATTERNS) {
    if (pattern.test(text)) throw new Error("Aurora user model rejects protected-topic inferences (health, belief, politics, ethnicity, sexuality or credentials).");
  }
}
