import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { auroraRound, DurableJsonState } from "../util/aurora-state.js";

interface Experience { id: string; tenantId: string; sessionId: string; taskDescription: string; steps: Array<{ action: string; tool: string; input: string; output: string; duration: number; success: boolean }>; outcome: "success" | "failure" | "partial"; totalDurationMs: number; tokenCost: number; lesson: string; tags: string[]; createdAt: string; }
interface CompiledSkill { id: string; tenantId: string; name: string; version: number; description: string; procedure: Array<{ step: number; action: string; tool: string; description: string; guard: string; fallback: string }>; requiredCapabilities: string[]; estimatedDurationMs: number; estimatedTokenCost: number; confidence: number; successCount: number; failureCount: number; sourceExperienceIds: string[]; stage: "candidate" | "evaluating" | "approved" | "production" | "deprecated"; createdAt: string; updatedAt: string; }

interface CompilerStateShape { schemaVersion: number; experiences: Experience[]; skills: CompiledSkill[]; }

export class ExperienceCompilerService {
  private store: DurableJsonState<CompilerStateShape>;
  constructor(private baseDir: string) {
    this.store = new DurableJsonState<CompilerStateShape>(join(baseDir, "experience-compiler.json"), () => ({ schemaVersion: 1, experiences: [], skills: [] }), (v) => { const s = v as CompilerStateShape; return !!s && s.schemaVersion === 1; }, "Aurora experience compiler");
  }
  async init(): Promise<void> { await this.store.read(); }

  async recordExperience(exp: Omit<Experience, "id" | "createdAt">): Promise<Experience> {
    const e: Experience = { ...exp, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.store.mutate(s => { s.experiences.push(e); });
    return e;
  }

  async compileSkills(tenantId: string): Promise<CompiledSkill[]> {
    return await this.store.mutate(s => {
      const tenantExp = s.experiences.filter(e => e.tenantId === tenantId && e.outcome === "success");
      const groups = new Map<string, Experience[]>();
      for (const exp of tenantExp) { const key = exp.tags.sort().join(","); if (!key) continue; const arr = groups.get(key) ?? []; arr.push(exp); groups.set(key, arr); }
      const compiled: CompiledSkill[] = [];
      for (const [tagKey, exps] of groups) {
        if (exps.length < 3) continue;
        const existing = s.skills.find(sk => sk.tenantId === tenantId && sk.requiredCapabilities.join(",") === tagKey);
        if (existing) { existing.sourceExperienceIds = exps.map(e => e.id); existing.estimatedDurationMs = Math.round(exps.reduce((sum, e) => sum + e.totalDurationMs, 0) / exps.length); existing.estimatedTokenCost = Math.round(exps.reduce((sum, e) => sum + e.tokenCost, 0) / exps.length); existing.confidence = auroraRound(Math.min(1, exps.length / 10)); existing.version++; existing.updatedAt = new Date().toISOString(); continue; }
        const procedure = this.extractProcedure(exps);
        const skill: CompiledSkill = { id: randomUUID(), tenantId, name: exps[0]!.tags.slice(0, 3).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(" ") + " Skill", version: 1, description: `Auto-compiled from ${exps.length} experiences`, procedure, requiredCapabilities: exps[0]!.tags, estimatedDurationMs: Math.round(exps.reduce((sum, e) => sum + e.totalDurationMs, 0) / exps.length), estimatedTokenCost: Math.round(exps.reduce((sum, e) => sum + e.tokenCost, 0) / exps.length), confidence: auroraRound(Math.min(1, exps.length / 10)), successCount: exps.length, failureCount: 0, sourceExperienceIds: exps.map(e => e.id), stage: "candidate", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        s.skills.push(skill); compiled.push(skill);
      }
      return compiled;
    });
  }

  async recordSkillOutcome(skillId: string, success: boolean): Promise<void> {
    await this.store.mutate(s => { const sk = s.skills.find(x => x.id === skillId); if (!sk) return; if (success) { sk.successCount++; sk.confidence = auroraRound(Math.min(1, sk.confidence + 0.05)); } else { sk.failureCount++; sk.confidence = auroraRound(Math.max(0, sk.confidence - 0.1)); } sk.updatedAt = new Date().toISOString(); });
  }

  async promoteSkill(skillId: string, newStage: CompiledSkill["stage"]): Promise<void> {
    await this.store.mutate(s => { const sk = s.skills.find(x => x.id === skillId); if (sk) { sk.stage = newStage; sk.updatedAt = new Date().toISOString(); } });
  }

  async findSkill(tenantId: string, taskTags: string[]): Promise<CompiledSkill | undefined> {
    const s = await this.store.read();
    return s.skills.filter(sk => sk.tenantId === tenantId && (sk.stage === "approved" || sk.stage === "production") && sk.requiredCapabilities.some(t => taskTags.includes(t))).sort((a, b) => b.confidence - a.confidence)[0];
  }

  async getSkills(tenantId: string): Promise<CompiledSkill[]> { const s = await this.store.read(); return s.skills.filter(sk => sk.tenantId === tenantId).sort((a, b) => b.confidence - a.confidence); }
  async getExperiences(tenantId: string, tags?: string[]): Promise<Experience[]> { const s = await this.store.read(); return s.experiences.filter(e => e.tenantId === tenantId && (!tags?.length || tags.some(t => e.tags.includes(t)))).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); }

  private extractProcedure(exps: Experience[]): CompiledSkill["procedure"] {
    const stepCounts = new Map<string, { action: string; tool: string; count: number }>();
    for (const exp of exps) for (const step of exp.steps) { const key = `${step.action}:${step.tool}`; const d = stepCounts.get(key) ?? { action: step.action, tool: step.tool, count: 0 }; d.count++; stepCounts.set(key, d); }
    return [...stepCounts.values()].filter(s => s.count >= 2).sort((a, b) => b.count - a.count).slice(0, 15).map((s, i) => ({ step: i + 1, action: s.action, tool: s.tool, description: `${s.action} using ${s.tool}`, guard: "", fallback: "" }));
  }

  // ═══ P2: Skill Transfer ═══

  async transferSkill(skillId: string, targetTenantId: string, adaptation?: string): Promise<CompiledSkill | null> {
const s = await this.store.read();
    const skill = s.skills.find(sk => sk.id === skillId);
    if (!skill) return null;
    const transferred: CompiledSkill = {
      ...skill,
      id: `transfer-${Date.now()}`,
      tenantId: targetTenantId,
      stage: "candidate",
      confidence: skill.confidence * 0.7,
      transferSource: skillId,
      adaptation: adaptation ?? "",
      createdAt: new Date().toISOString(),
    } as any;
    s.skills.push(transferred);
    await this.store.mutate(ss => { ss.skills = s.skills; });
    return transferred;
  }

  async findSimilarSkills(tenantId: string, tags: string[]): Promise<Array<{
skill: CompiledSkill; similarity: number
    }>> {
    const s = await this.store.read();
    const skills = s.skills.filter(sk => sk.tenantId === tenantId);
    return skills.map(sk => {
      const overlap = (sk.requiredCapabilities ?? []).filter((t: string) => tags.includes(t)).length;
      const total = new Set([...(sk.requiredCapabilities ?? []), ...tags]).size;
      const similarity = total > 0 ? overlap / total : 0;
      return { skill: sk, similarity };
    }).filter(x => x.similarity > 0).sort((a, b) => b.similarity - a.similarity);
  }

  async getStats(tenantId: string) {
    const s = await this.store.read();
    const pf = (s as any).skills?.filter((x: any) => x.tenantId === tenantId) ?? [];
    const sf = (s as any).experiences?.filter((x: any) => x.tenantId === tenantId) ?? [];
    return { totalPrimary: pf.length, totalSecondary: sf.length }

};

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
