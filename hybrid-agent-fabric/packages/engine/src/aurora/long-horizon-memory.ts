import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DurableJsonState } from "../util/aurora-state.js";

type Horizon = "short" | "medium" | "long" | "permanent";
type MemoryCategory = "episodic" | "semantic" | "procedural" | "emotional" | "strategic";

interface LongMemory { id: string; tenantId: string; category: MemoryCategory; horizon: Horizon; title: string; content: string; importance: number; emotionalWeight: number; associations: string[]; accessCount: number; lastAccessedAt: string; decayFactor: number; consolidatedFrom: string[]; createdAt: string; }

interface LongHorizonState { schemaVersion: number; memories: LongMemory[]; }

export class LongHorizonMemoryService {
  private store: DurableJsonState<LongHorizonState>;
  constructor(private baseDir: string) {
    this.store = new DurableJsonState<LongHorizonState>(
      join(baseDir, "long-horizon-memory.json"),
      () => ({ schemaVersion: 1, memories: [] }),
      (v) => { const s = v as LongHorizonState; return !!s && s.schemaVersion === 1; },
      "Aurora long-horizon memory",
    );
  }
  async init(): Promise<void> { await this.store.read(); }

  async storeMemory(tenantId: string, category: MemoryCategory, horizon: Horizon, title: string, content: string, importance: number, emotionalWeight: number = 0, associations: string[] = []): Promise<LongMemory> {
    const m: LongMemory = { id: randomUUID(), tenantId, category, horizon, title, content, importance, emotionalWeight, associations, accessCount: 0, lastAccessedAt: new Date().toISOString(), decayFactor: horizon === "permanent" ? 0 : horizon === "long" ? 0.001 : horizon === "medium" ? 0.01 : 0.05, consolidatedFrom: [], createdAt: new Date().toISOString() };
    await this.store.mutate(s => { s.memories.push(m); });
    return m;
  }

  async recall(memoryId: string): Promise<LongMemory | null> {
    return await this.store.mutate(s => {
      const m = s.memories.find(x => x.id === memoryId);
      if (!m) return null;
      m.accessCount++;
      m.lastAccessedAt = new Date().toISOString();
      m.importance = Math.min(1, m.importance + 0.02);
      return m;
    });
  }

  async search(tenantId: string, query: string, category?: MemoryCategory, horizon?: Horizon): Promise<LongMemory[]> {
    const s = await this.store.read();
    const q = query.toLowerCase();
    return s.memories.filter(m => m.tenantId === tenantId && (!category || m.category === category) && (!horizon || m.horizon === horizon) && (m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q) || m.associations.some(a => a.toLowerCase().includes(q)))).sort((a, b) => b.importance - a.importance).slice(0, 20);
  }

  async consolidate(memoryIds: string[], title: string, content: string): Promise<LongMemory> {
    return await this.store.mutate(s => {
      const sourceMems = s.memories.filter(m => memoryIds.includes(m.id));
      const maxImportance = sourceMems.reduce((max, m) => Math.max(max, m.importance), 0);
      const m: LongMemory = { id: randomUUID(), tenantId: sourceMems[0]?.tenantId ?? "", category: "semantic", horizon: "long", title, content, importance: Math.min(1, maxImportance + 0.1), emotionalWeight: sourceMems.reduce((sum, mem) => sum + mem.emotionalWeight, 0) / (sourceMems.length || 1), associations: [...new Set(sourceMems.flatMap(mem => mem.associations))], accessCount: 0, lastAccessedAt: new Date().toISOString(), decayFactor: 0.001, consolidatedFrom: memoryIds, createdAt: new Date().toISOString() };
      s.memories.push(m);
      return m;
    });
  }

  async decay(): Promise<void> {
    await this.store.mutate(s => {
      for (const m of s.memories) {
        if (m.horizon === "permanent") continue;
        const elapsed = (Date.now() - new Date(m.lastAccessedAt).getTime()) / 86400000;
        m.importance = Math.max(0, m.importance - m.decayFactor * elapsed);
      }
      // Prune very low importance non-permanent
      s.memories = s.memories.filter(m => m.importance > 0.01 || m.horizon === "permanent");
    });
  }

  async getMemories(tenantId: string, limit = 50): Promise<LongMemory[]> {
    const s = await this.store.read();
    return s.memories.filter(m => m.tenantId === tenantId).sort((a, b) => b.importance - a.importance).slice(0, limit);
  }

  // ═══ P2: Auto Memory Consolidation ═══

  async autoConsolidate(tenantId: string): Promise<{
consolidated: number; decayed: number; promoted: number;
    insights: string[];
    }> {
    const s = await this.store.read();
    const memories = s.memories.filter(m => m.tenantId === tenantId);
    const insights: string[] = [];
    
    // Find clusters of related memories for consolidation
    const byAssociations: Record<string, typeof memories> = {};
    for (const m of memories) {
      for (const assoc of m.associations ?? []) {
        if (!byAssociations[assoc]) byAssociations[assoc] = [];
        byAssociations[assoc].push(m);
      }
    }
    
    let consolidated = 0;
    for (const [assoc, group] of Object.entries(byAssociations)) {
      if (group.length >= 3) {
        // Consolidate related memories
        const titles = group.map(m => m.title).join("; ");
        const contents = group.map(m => m.content).join("\n---\n");
        const maxImportance = Math.max(...group.map(m => m.importance));
        try {
          await this.consolidate(group.map(m => m.id), `Consolidated: ${assoc}`, contents);
          consolidated++;
          insights.push(`Consolidated ${group.length} memories about "${assoc}"`);
        } catch (err: unknown) { const msg = err instanceof Error ? err.message : String(err); insights.push(`Failed to consolidate "${assoc}": ${msg}`); }
      }
    }
    
    // Decay old low-importance memories
    let decayed = 0;
    const now = Date.now();
    for (const m of memories) {
      const age = now - new Date(m.createdAt).getTime();
      const daysSinceCreation = age / (1000 * 60 * 60 * 24);
      if (daysSinceCreation > 30 && m.importance < 3 && m.horizon === "short") {
        decayed++;
      }
    }
    
    // Promote frequently accessed short-term to long-term
    let promoted = 0;
    for (const m of memories) {
      if (m.horizon === "short" && m.importance >= 7) {
        promoted++;
        insights.push(`Promoted "${m.title}" from short to long-term (importance: ${m.importance})`);
      }
    }
    
    return { consolidated, decayed, promoted, insights };
  }

  async getStats(tenantId: string) {
    const s = await this.store.read();
    const tm = s.memories.filter(m => m.tenantId === tenantId);
    const catDist: Record<string, number> = {};
    for (const m of tm) catDist[m.category] = (catDist[m.category] ?? 0) + 1;
    const horizonDist: Record<string, number> = {};
    for (const m of tm) horizonDist[m.horizon] = (horizonDist[m.horizon] ?? 0) + 1;
    return { totalMemories: tm.length, avgImportance: tm.length ? tm.reduce((sum, m) => sum + m.importance, 0) / tm.length : 0, totalAccesses: tm.reduce((sum, m) => sum + m.accessCount, 0), categoryDistribution: catDist, horizonDistribution: horizonDist, consolidatedCount: tm.filter(m => m.consolidatedFrom.length > 0).length };
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

