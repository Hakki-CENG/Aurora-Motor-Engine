/**
 * Model Capability Registry
 * P1-56: Her model için capability metadata tutar.
 * Context window, vision, tools, reasoning, latency, cost, availability.
 * AdaptiveRouter ve ModelSelectionEngine bu registry'yi kullanır.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DurableJsonState } from "../util/aurora-state.js";

export type ModelCapability =
  | "text" | "vision" | "audio" | "code" | "reasoning" | "math"
  | "tool_calling" | "structured_output" | "long_context" | "fast"
  | "creative" | "multilingual" | "embedding";

export interface ModelProfile {
  id: string;
  /** Provider-specific model identifier (e.g., "qwen-27b", "claude-3-opus") */
  modelId: string;
  /** Human-readable name */
  displayName: string;
  /** Provider name */
  provider: string;
  /** What this model can do */
  capabilities: ModelCapability[];
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Average latency for typical requests (ms) */
  avgLatencyMs: number;
  /** Cost per 1K input tokens (USD) */
  costPer1kInput: number;
  /** Cost per 1K output tokens (USD) */
  costPer1kOutput: number;
  /** Historical reliability (0-1, learned from usage) */
  reliability: number;
  /** Historical success rate (0-1) */
  successRate: number;
  /** Total requests made */
  totalRequests: number;
  /** Total successful requests */
  successfulRequests: number;
  /** Average quality score (0-1, from benchmarks) */
  qualityScore: number;
  /** Whether this model is currently available */
  available: boolean;
  /** Specialization domains (e.g., "coding", "research", "creative") */
  specializations: string[];
  /** Last benchmark timestamp */
  lastBenchmarkAt: string;
  createdAt: string;
  updatedAt: string;
}

interface BenchmarkResult {
  id: string;
  modelId: string;
  benchmark: string;
  score: number;
  latencyMs: number;
  costUsd: number;
  timestamp: string;
}

interface ModelCapabilityState {
  schemaVersion: number;
  profiles: ModelProfile[];
  benchmarks: BenchmarkResult[];
}

export class ModelCapabilityRegistryService {
  private store: DurableJsonState<ModelCapabilityState>;

  constructor(private baseDir: string) {
    this.store = new DurableJsonState<ModelCapabilityState>(
      join(baseDir, "model-capability-registry.json"),
      () => ({ schemaVersion: 1, profiles: [], benchmarks: [] }),
      (v) => { const s = v as ModelCapabilityState; return !!s && s.schemaVersion === 1; },
      "Aurora model capability registry",
    );
  }

  async init(): Promise<void> { await this.store.read(); }

  /**
   * Register a new model with its capabilities.
   */
  async register(input: {
    modelId: string;
    displayName: string;
    provider: string;
    capabilities: ModelCapability[];
    contextWindow: number;
    maxOutputTokens?: number;
    avgLatencyMs?: number;
    costPer1kInput?: number;
    costPer1kOutput?: number;
    specializations?: string[];
  }): Promise<ModelProfile> {
    const now = new Date().toISOString();
    const profile: ModelProfile = {
      id: randomUUID(),
      modelId: input.modelId,
      displayName: input.displayName,
      provider: input.provider,
      capabilities: input.capabilities,
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens ?? 4096,
      avgLatencyMs: input.avgLatencyMs ?? 2000,
      costPer1kInput: input.costPer1kInput ?? 0.001,
      costPer1kOutput: input.costPer1kOutput ?? 0.002,
      reliability: 0.9,
      successRate: 1.0,
      totalRequests: 0,
      successfulRequests: 0,
      qualityScore: 0.5,
      available: true,
      specializations: input.specializations ?? [],
      lastBenchmarkAt: "",
      createdAt: now,
      updatedAt: now,
    };

    await this.store.mutate(s => {
      const existing = s.profiles.findIndex(p => p.modelId === input.modelId);
      if (existing >= 0) {
        s.profiles[existing] = profile;
      } else {
        s.profiles.push(profile);
      }
    });

    return profile;
  }

  /**
   * Record a request outcome — updates reliability and success rate.
   */
  async recordOutcome(modelId: string, success: boolean, latencyMs: number): Promise<void> {
    await this.store.mutate(s => {
      const p = s.profiles.find(x => x.modelId === modelId);
      if (!p) return;
      p.totalRequests++;
      if (success) p.successfulRequests++;
      p.successRate = p.successfulRequests / p.totalRequests;
      p.reliability = p.reliability * 0.95 + (success ? 0.05 : 0);
      p.avgLatencyMs = Math.round((p.avgLatencyMs * (p.totalRequests - 1) + latencyMs) / p.totalRequests);
      p.updatedAt = new Date().toISOString();
    });
  }

  /**
   * Record a benchmark result.
   */
  async recordBenchmark(modelId: string, benchmark: string, score: number, latencyMs: number, costUsd: number): Promise<void> {
    const result: BenchmarkResult = {
      id: randomUUID(), modelId, benchmark, score, latencyMs, costUsd, timestamp: new Date().toISOString(),
    };
    await this.store.mutate(s => {
      s.benchmarks.push(result);
      const p = s.profiles.find(x => x.modelId === modelId);
      if (p) {
        p.qualityScore = score;
        p.lastBenchmarkAt = result.timestamp;
        p.updatedAt = new Date().toISOString();
      }
    });
  }

  /**
   * Find the best model for a task based on required capabilities and strategy.
   */
  async selectBest(input: {
    requiredCapabilities: ModelCapability[];
    strategy: "performance" | "cost" | "quality" | "balanced";
    maxLatencyMs?: number;
    maxCostPer1k?: number;
    preferSpecialization?: string;
  }): Promise<ModelProfile | null> {
    const s = await this.store.read();
    let candidates = s.profiles.filter(p =>
      p.available &&
      input.requiredCapabilities.every(cap => p.capabilities.includes(cap))
    );

    if (input.maxLatencyMs) candidates = candidates.filter(p => p.avgLatencyMs <= input.maxLatencyMs!);
    if (input.maxCostPer1k) candidates = candidates.filter(p => p.costPer1kInput <= input.maxCostPer1k!);

    if (candidates.length === 0) return null;

    // Score each candidate
    const scored = candidates.map(p => {
      let score = 0;
      switch (input.strategy) {
        case "performance":
          score = p.qualityScore * 0.4 + p.reliability * 0.3 + p.successRate * 0.3;
          break;
        case "cost":
          score = (1 - p.costPer1kInput / 0.01) * 0.6 + p.reliability * 0.2 + p.qualityScore * 0.2;
          break;
        case "quality":
          score = p.qualityScore * 0.6 + p.successRate * 0.2 + p.reliability * 0.2;
          break;
        case "balanced":
          score = p.qualityScore * 0.25 + p.reliability * 0.25 + p.successRate * 0.25 + (1 - p.costPer1kInput / 0.01) * 0.25;
          break;
      }
      // Specialization bonus
      if (input.preferSpecialization && p.specializations.includes(input.preferSpecialization)) {
        score += 0.15;
      }
      return { profile: p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.profile;
  }

  /**
   * Get all registered models.
   */
  async getProfiles(): Promise<ModelProfile[]> {
    const s = await this.store.read();
    return s.profiles;
  }

  /**
   * Get a specific model profile.
   */
  async getProfile(modelId: string): Promise<ModelProfile | null> {
    const s = await this.store.read();
    return s.profiles.find(p => p.modelId === modelId) ?? null;
  }

  /**
   * Get benchmark history for a model.
   */
  async getBenchmarks(modelId: string): Promise<BenchmarkResult[]> {
    const s = await this.store.read();
    return s.benchmarks.filter(b => b.modelId === modelId).sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Set model availability.
   */
  async setAvailability(modelId: string, available: boolean): Promise<void> {
    await this.store.mutate(s => {
      const p = s.profiles.find(x => x.modelId === modelId);
      if (p) { p.available = available; p.updatedAt = new Date().toISOString(); }
    });
  }

  /**
   * Registry statistics.
   */
  // ═══ P2: Multi-Model Orchestration ═══

  async orchestrate(input: {
task: string; requiredCapabilities: string[];
    maxModels?: number; preferCost?: boolean;
    }): Promise<{
    selectedModels: Array<{ modelId: string; role: string; confidence: number; estimatedCost: number }>;
    fallbackChain: string[];
    rationale: string[];
  }> {
    const s = await this.store.read();
    const available = s.profiles.filter(p => p.available);
    const maxModels = input.maxModels ?? 3;
    const rationale: string[] = [];

    // Score models by capability match
    const scored = available.map(p => {
      const capMatch = input.requiredCapabilities.filter(c => 
        p.capabilities.some((cap: any) => ((cap as any).domain ?? (cap as any).name ?? "").toLowerCase().includes(c.toLowerCase()))
      ).length;
      const score = capMatch / Math.max(1, input.requiredCapabilities.length);
      return { profile: p, score, capMatch };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    const selectedModels = scored.slice(0, maxModels).map((x, i) => ({
      modelId: x.profile.modelId,
      role: i === 0 ? "primary" : i === 1 ? "validator" : "fallback",
      confidence: x.score,
      estimatedCost: (x.profile.costPer1kInput + x.profile.costPer1kOutput) / 2,
    }));

    const fallbackChain = scored.slice(maxModels, maxModels + 3).map(x => x.profile.modelId);

    if (selectedModels.length === 0) {
      rationale.push("No models match required capabilities — consider registering more models");
    } else {
      rationale.push(`Selected ${selectedModels.length} model(s) for task`);
      rationale.push(`Primary: ${selectedModels[0]?.modelId ?? "none"} (${((selectedModels[0]?.confidence ?? 0) * 100).toFixed(0)}% capability match)`);
    }

    return { selectedModels, fallbackChain, rationale };
  }

  async getStats() {
    const s = await this.store.read();
    return {
      totalModels: s.profiles.length,
      availableModels: s.profiles.filter(p => p.available).length,
      totalBenchmarks: s.benchmarks.length,
      avgReliability: s.profiles.length ? s.profiles.reduce((sum, p) => sum + p.reliability, 0) / s.profiles.length : 0,
      avgQuality: s.profiles.length ? s.profiles.reduce((sum, p) => sum + p.qualityScore, 0) / s.profiles.length : 0,
      byProvider: s.profiles.reduce((acc, p) => { acc[p.provider] = (acc[p.provider] ?? 0) + 1; return acc; }, {} as Record<string, number>),
      byCapability: s.profiles.reduce((acc, p) => {
        for (const cap of p.capabilities) acc[cap] = (acc[cap] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
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

