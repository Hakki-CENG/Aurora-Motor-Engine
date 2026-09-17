import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DurableJsonState } from "../util/aurora-state.js";

type BugType = "logic" | "state" | "timing" | "resource" | "data" | "integration" | "config" | "unknown";
type FixStatus = "proposed" | "applied" | "verified" | "reverted";

interface Bug { id: string; tenantId: string; type: BugType; description: string; symptoms: string[]; affectedSubsystem: string; reproductionSteps: string[]; severity: "low" | "medium" | "high" | "critical"; createdAt: string; }
interface Fix { id: string; bugId: string; description: string; rootCause: string; fix: string; status: FixStatus; verifiedBy: string; appliedAt: string; }
interface DebugSession { id: string; tenantId: string; bugs: string[]; fixes: string[]; duration: number; outcome: "resolved" | "partial" | "unresolved"; lessonsLearned: string[]; createdAt: string; }

interface DebugState { schemaVersion: number; bugs: Bug[]; fixes: Fix[]; sessions: DebugSession[]; }

export class SelfDebuggingService {
  private store: DurableJsonState<DebugState>;
  constructor(private baseDir: string) {
    this.store = new DurableJsonState<DebugState>(
      join(baseDir, "self-debugging.json"),
      () => ({ schemaVersion: 1, bugs: [], fixes: [], sessions: [] }),
      (v) => { const s = v as DebugState; return !!s && s.schemaVersion === 1; },
      "Aurora self-debugging",
    );
  }
  async init(): Promise<void> { await this.store.read(); }

  async reportBug(tenantId: string, type: BugType, description: string, symptoms: string[], affectedSubsystem: string, reproductionSteps: string[], severity: Bug["severity"]): Promise<Bug> {
    const bug: Bug = { id: randomUUID(), tenantId, type, description, symptoms, affectedSubsystem, reproductionSteps, severity, createdAt: new Date().toISOString() };
    await this.store.mutate(s => { s.bugs.push(bug); });
    return bug;
  }

  async proposeFix(bugId: string, description: string, rootCause: string, fix: string): Promise<Fix> {
    const f: Fix = { id: randomUUID(), bugId, description, rootCause, fix, status: "proposed", verifiedBy: "", appliedAt: "" };
    await this.store.mutate(s => { s.fixes.push(f); });
    return f;
  }

  async applyFix(fixId: string): Promise<void> {
    await this.store.mutate(s => { const f = s.fixes.find(x => x.id === fixId); if (f) { f.status = "applied"; f.appliedAt = new Date().toISOString(); } });
  }

  async verifyFix(fixId: string, verifiedBy: string, success: boolean): Promise<void> {
    await this.store.mutate(s => { const f = s.fixes.find(x => x.id === fixId); if (f) { f.status = success ? "verified" : "reverted"; f.verifiedBy = verifiedBy; } });
  }

  async startDebugSession(tenantId: string, bugIds: string[]): Promise<DebugSession> {
    const session: DebugSession = { id: randomUUID(), tenantId, bugs: bugIds, fixes: [], duration: 0, outcome: "unresolved", lessonsLearned: [], createdAt: new Date().toISOString() };
    await this.store.mutate(s => { s.sessions.push(session); });
    return session;
  }

  async completeDebugSession(sessionId: string, outcome: DebugSession["outcome"], lessons: string[]): Promise<void> {
    await this.store.mutate(s => {
      const sess = s.sessions.find(x => x.id === sessionId);
      if (!sess) return;
      sess.outcome = outcome;
      sess.lessonsLearned = lessons;
      sess.duration = Date.now() - new Date(sess.createdAt).getTime();
    });
  }

  async getBugs(tenantId: string, limit = 30): Promise<Bug[]> {
    const s = await this.store.read();
    return s.bugs.filter(b => b.tenantId === tenantId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
  }

  async getStats(tenantId: string) {
    const s = await this.store.read();
    const tb = s.bugs.filter(b => b.tenantId === tenantId);
    const tf = s.fixes.filter(f => tb.some(b => b.id === f.bugId));
    const verified = tf.filter(f => f.status === "verified").length;
    const typeDist: Record<string, number> = {};
    for (const b of tb) typeDist[b.type] = (typeDist[b.type] ?? 0) + 1;
    return { totalBugs: tb.length, totalFixes: tf.length, verifiedFixes: verified, reverted: tf.filter(f => f.status === "reverted").length, fixRate: tf.length ? verified / tf.length : 0, bugTypeDistribution: typeDist, totalSessions: s.sessions.filter(ss => ss.tenantId === tenantId).length };
  }

  // ═══ P2: Self-Healing ═══

  async selfHeal(tenantId: string, subsystem: string, symptoms: string[]): Promise<{
diagnosis: string; severity: "low" | "medium" | "high" | "critical";
    healingSteps: Array<{ step: string; action: string; risk: "low" | "medium" | "high" }>;
    estimatedRecoveryMs: number;
    }> {
    await this.reportBug(tenantId, "integration", `Self-heal: ${subsystem} unhealthy`, symptoms, subsystem, ["auto-detected"], "high");
    const s = symptoms.map(x => x.toLowerCase()).join(" ");
    let diagnosis = `${subsystem}: Unknown issue`;
    if (s.includes("timeout") || s.includes("slow")) diagnosis = `${subsystem}: Performance degradation`;
    else if (s.includes("error") || s.includes("crash")) diagnosis = `${subsystem}: Runtime error`;
    else if (s.includes("memory") || s.includes("leak")) diagnosis = `${subsystem}: Memory issue`;
    else if (s.includes("stale") || s.includes("stuck")) diagnosis = `${subsystem}: State corruption`;
    const severity = symptoms.length >= 3 ? "critical" as const : symptoms.length >= 2 ? "high" as const : "medium" as const;
    const healingSteps: Array<{ step: string; action: string; risk: "low" | "medium" | "high" }> = [
      { step: "diagnose", action: `Analyze ${subsystem} logs`, risk: "low" },
      { step: "restart", action: `Restart ${subsystem} with clean state`, risk: "low" },
      { step: "fallback", action: `Enable fallback mode`, risk: "medium" },
      { step: "rollback", action: `Rollback to last good state`, risk: "medium" },
    ];
    if (severity === "critical") healingSteps.push({ step: "replace", action: `Replace with alternative`, risk: "high" as const });
    return { diagnosis, severity, healingSteps, estimatedRecoveryMs: severity === "critical" ? 60000 : 30000 };
  }

  // ═══ P3: Explainability ═══

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

