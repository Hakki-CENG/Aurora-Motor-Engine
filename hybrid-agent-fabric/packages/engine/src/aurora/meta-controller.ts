import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DurableJsonState, auroraRound } from "../util/aurora-state.js";

// ═══ 31. Sistem: Cognitive Meta-Controller ═══
// Tüm30 alt sistemi orkestre eden üst düzey kontrolcü.
// Kompleksite analizi, alt sistem seçim, performans optimizasyonu,
// otomatik uyku/uyanma döngüleri, hata tahmin ve kendi kendini iyileştirme.

type CognitiveComplexity = "trivial" | "simple" | "moderate" | "complex" | "extreme";
type SystemHealth = "healthy" | "degraded" | "critical" | "offline";
type MetaMode = "normal" | "conservative" | "aggressive" | "learning" | "recovery";

interface TaskProfile { id: string; tenantId: string; taskDescription: string; complexity: CognitiveComplexity; estimatedTokens: number; estimatedDurationMs: number; requiredSubsystems: string[]; parallelizable: boolean; riskLevel: string; userPatience: string; createdAt: string; }
interface ExecutionPhase { id: string; name: string; subsystems: string[]; parallel: boolean; optional: boolean; timeoutMs: number; earlyExitIf: string; dependsOn: string[]; }
interface ExecutionPlan { id: string; profileId: string; phases: ExecutionPhase[]; totalEstimatedMs: number; totalEstimatedTokens: number; parallelGroups: string[][]; earlyExitConditions: string[]; fallbackPlan: string; createdAt: string; }
interface SubsystemHealth { name: string; status: SystemHealth; avgLatencyMs: number; avgTokenCost: number; successRate: number; usageCount: number; errorCount: number; lastError: string; lastUsedAt: string; consecutiveFailures: number; }
interface MetaDecision { id: string; tenantId: string; taskId: string; profile: TaskProfile; plan: ExecutionPlan; actualDurationMs: number; actualTokensUsed: number; actualSubsystemsUsed: string[]; outcome: string; efficiency: number; lessonsForMeta: string[]; createdAt: string; completedAt: string; }
interface SystemAlert { id: string; subsystem: string; level: "info" | "warning" | "critical"; message: string; timestamp: string; acknowledged: boolean; }
interface MetaInsight { id: string; category: "optimization" | "risk" | "pattern" | "anomaly" | "recommendation"; insight: string; confidence: number; impact: "low" | "medium" | "high"; subsystems: string[]; timestamp: string; }
interface MetaConfig { mode: MetaMode; maxConcurrentSubsystems: number; healthCheckIntervalMs: number; autoRecovery: boolean; learningRate: number; explorationRate: number; }
interface MetaStateShape {
  schemaVersion: number;
  decisions: MetaDecision[];
  subsystemHealth: SubsystemHealth[];
  alerts: SystemAlert[];
  insights: MetaInsight[];
  config: MetaConfig;
  cycleCount: number;
  totalSystemActivations: number;
  globalSuccessRate: number;
  modeHistory: { mode: MetaMode; reason: string; timestamp: string; }[];
}

// ═══ Phase1-5 alt sistem listesi ═══
const ALL_SUBSYSTEMS = [
  // Phase1: Self-Awareness & Observability
  "self-model", "uncertainty-engine", "failure-taxonomy", "cognitive-telemetry",
  // Phase2: Memory & Learning
  "neural-memory-fusion", "experience-compiler", "sleep-cycle", "recursive-skill-discovery",
  // Phase3: Reasoning & Simulation
  "counterfactual-simulator", "multi-hypothesis", "internal-critic", "experiment-engine", "planner-v2",
  // Phase4: Agent Society
  "agent-economy", "reputation", "resource-intelligence", "shared-learning",
  "dynamic-composition", "capability-marketplace", "swarm-orchestration",
  // Phase5: Advanced Cognitive
  "benchmark-lab", "adaptive-router", "goal-stack", "attention-v2",
  "self-debugging", "causal-graph", "long-horizon-memory", "neural-cognitive-core", "learned-world-model",
  // Mevcut Aurora servisleri
  "memory", "world-model", "planner", "simulation", "critic", "verification",
];

const COMPLEXITY_MAP: Record<CognitiveComplexity, string[]> = {
  trivial: [],
  simple: ["memory"],
  moderate: ["memory", "world-model", "planner"],
  complex: ["memory", "world-model", "planner", "simulation", "uncertainty-engine", "internal-critic", "verification", "causal-graph"],
  extreme: [
    "memory", "neural-memory-fusion", "world-model", "planner", "simulation",
    "multi-hypothesis", "uncertainty-engine", "internal-critic", "self-model",
    "experiment-engine", "verification", "experience-compiler", "failure-taxonomy",
    "counterfactual-simulator", "causal-graph", "learned-world-model", "attention-v2",
    "cognitive-telemetry", "neural-cognitive-core",
  ],
};

export class MetaControllerService {
  private store: DurableJsonState<MetaStateShape>;
  constructor(private baseDir: string) {
    this.store = new DurableJsonState<MetaStateShape>(
      join(baseDir, "meta-controller.json"),
      () => ({
        schemaVersion: 2, // v2: 31-sistem orchestrator
        decisions: [],
        subsystemHealth: ALL_SUBSYSTEMS.map(name => ({
          name, status: "healthy" as SystemHealth, avgLatencyMs: 0, avgTokenCost: 0,
          successRate: 1, usageCount: 0, errorCount: 0, lastError: "", lastUsedAt: "",
          consecutiveFailures: 0,
        })),
        alerts: [],
        insights: [],
        config: {
          mode: "normal" as MetaMode,
          maxConcurrentSubsystems: 8,
          healthCheckIntervalMs: 30000,
          autoRecovery: true,
          learningRate: 0.1,
          explorationRate: 0.05,
        },
        cycleCount: 0,
        totalSystemActivations: 0,
        globalSuccessRate: 1,
        modeHistory: [],
      }),
      (v) => { const s = v as MetaStateShape; return !!s && (s.schemaVersion === 1 || s.schemaVersion === 2); },
      "Aurora cognitive meta-controller (31-system orchestrator)",
    );
  }
  async init(): Promise<void> { await this.store.read(); }

  // ═══ Kompleksite Analizi ═══
  analyzeComplexity(taskDescription: string, context?: string): CognitiveComplexity {
    const text = (taskDescription + " " + (context ?? "")).toLowerCase();
    let score = 0;
    if (text.includes("what is") || text.includes("ne kadar") || text.includes("hangi gün")) score += 0;
    if (text.includes("how to") || text.includes("nasıl")) score += 1;
    if (text.includes("implement") || text.includes("build") || text.includes("create") || text.includes("develop") || text.includes("geliştir") || text.includes("oluştur")) score += 2;
    if (text.includes("architecture") || text.includes("mimari") || text.includes("design") || text.includes("system")) score += 3;
    if (text.includes("refactor") || text.includes("optimize") || text.includes("migrate") || text.includes("scale")) score += 3;
    if (text.includes("from scratch") || text.includes("sıfırdan") || text.includes("entire") || text.includes("comprehensive") || text.includes("kapsamlı")) score += 4;
    if (taskDescription.length > 500) score += 2;
    if (taskDescription.length > 1000) score += 2;
    if (taskDescription.split("\n").length > 5) score += 2;
    if (score <= 1) return "trivial";
    if (score <= 3) return "simple";
    if (score <= 6) return "moderate";
    if (score <= 10) return "complex";
    return "extreme";
  }

  // ═══ Görev Profilleme ═══
  async profileTask(tenantId: string, taskDescription: string, context?: string): Promise<TaskProfile> {
    const complexity = this.analyzeComplexity(taskDescription, context);
    const subsystems = COMPLEXITY_MAP[complexity];
    const tokenMap: Record<CognitiveComplexity, number> = { trivial: 200, simple: 1000, moderate: 5000, complex: 20000, extreme: 100000 };
    const durationMap: Record<CognitiveComplexity, number> = { trivial: 500, simple: 2000, moderate: 10000, complex: 30000, extreme: 120000 };
    return {
      id: randomUUID(), tenantId, taskDescription: taskDescription.slice(0, 500), complexity,
      estimatedTokens: tokenMap[complexity],
      estimatedDurationMs: durationMap[complexity] + subsystems.length * 2000,
      requiredSubsystems: subsystems, parallelizable: complexity === "complex" || complexity === "extreme",
      riskLevel: complexity === "extreme" ? "high" : complexity === "complex" ? "medium" : "low",
      userPatience: complexity === "trivial" ? "low" : complexity === "simple" ? "medium" : "high",
      createdAt: new Date().toISOString(),
    };
  }

  // ═══ Execution Plan Oluşturma ═══
  createPlan(profile: TaskProfile): ExecutionPlan {
    const phases: ExecutionPhase[] = [];
    let pn = 0;

    // Phase1: Observe & Recall
    const subs1 = ["memory", "neural-memory-fusion", "long-horizon-memory"].filter(s => profile.requiredSubsystems.includes(s));
    if (subs1.length) phases.push({ id: `p${++pn}`, name: "Observe & Recall", subsystems: subs1, parallel: true, optional: false, timeoutMs: 5000, earlyExitIf: "", dependsOn: [] });

    // Phase2: Analyze & Assess
    const subs2 = ["world-model", "uncertainty-engine", "self-model", "learned-world-model", "causal-graph"].filter(s => profile.requiredSubsystems.includes(s));
    if (subs2.length) phases.push({ id: `p${++pn}`, name: "Analyze & Assess", subsystems: subs2, parallel: true, optional: false, timeoutMs: 10000, earlyExitIf: "", dependsOn: phases.length ? [phases[phases.length - 1]!.id] : [] });

    // Phase3: Plan & Simulate
    const subs3 = ["planner", "simulation", "multi-hypothesis", "counterfactual-simulator", "experiment-engine"].filter(s => profile.requiredSubsystems.includes(s));
    if (subs3.length) phases.push({ id: `p${++pn}`, name: "Plan & Simulate", subsystems: subs3, parallel: true, optional: false, timeoutMs: 15000, earlyExitIf: "", dependsOn: phases.length ? [phases[phases.length - 1]!.id] : [] });

    // Phase4: Verify & Critique
    const subs4 = ["internal-critic", "verification", "cognitive-telemetry"].filter(s => profile.requiredSubsystems.includes(s));
    if (subs4.length) phases.push({ id: `p${++pn}`, name: "Verify & Critique", subsystems: subs4, parallel: true, optional: true, timeoutMs: 10000, earlyExitIf: "", dependsOn: [] });

    // Phase5: Execute & Monitor
    const subs5 = ["attention-v2", "adaptive-router"].filter(s => profile.requiredSubsystems.includes(s));
    if (subs5.length) phases.push({ id: `p${++pn}`, name: "Execute & Monitor", subsystems: subs5, parallel: true, optional: false, timeoutMs: 8000, earlyExitIf: "", dependsOn: [] });

    // Phase6: Learn & Record
    const subs6 = ["experience-compiler", "failure-taxonomy", "shared-learning", "self-debugging"].filter(s => profile.requiredSubsystems.includes(s));
    if (subs6.length) phases.push({ id: `p${++pn}`, name: "Learn & Record", subsystems: subs6, parallel: true, optional: true, timeoutMs: 5000, earlyExitIf: "", dependsOn: [] });

    return {
      id: randomUUID(), profileId: profile.id, phases,
      totalEstimatedMs: phases.reduce((s, p) => s + p.timeoutMs, 0),
      totalEstimatedTokens: profile.estimatedTokens,
      parallelGroups: phases.filter(p => p.parallel).map(p => p.subsystems),
      earlyExitConditions: profile.complexity === "trivial" ? ["answer-available"] : [],
      fallbackPlan: profile.complexity === "extreme" ? "reduce-to-complex" : "",
      createdAt: new Date().toISOString(),
    };
  }

  // ═══ Karar Kaydetme ═══
  async recordDecision(tenantId: string, taskId: string, profile: TaskProfile, plan: ExecutionPlan, actual: { durationMs: number; tokensUsed: number; subsystemsUsed: string[]; outcome: string }): Promise<MetaDecision> {
    const efficiency = auroraRound(plan.totalEstimatedMs > 0 ? Math.min(2, actual.durationMs / plan.totalEstimatedMs) : 1);
    const lessons: string[] = [];
    if (efficiency > 1.5) lessons.push(`Task took ${auroraRound(efficiency)}x longer than estimated`);
    if (efficiency < 0.5) lessons.push("Task completed much faster than estimated");
    if (actual.outcome === "failure") lessons.push(`Failed with ${actual.subsystemsUsed.length} subsystems active`);
    if (actual.subsystemsUsed.length > 10) lessons.push("Too many subsystems — consider simpler decomposition");

    const decision: MetaDecision = {
      id: randomUUID(), tenantId, taskId, profile, plan,
      actualDurationMs: actual.durationMs, actualTokensUsed: actual.tokensUsed,
      actualSubsystemsUsed: actual.subsystemsUsed, outcome: actual.outcome,
      efficiency, lessonsForMeta: lessons,
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    };

    await this.store.mutate(s => {
      s.decisions.push(decision);
      s.cycleCount++;
      s.totalSystemActivations += actual.subsystemsUsed.length;

      // Update subsystem health
      for (const sub of actual.subsystemsUsed) {
        let health = s.subsystemHealth.find(c => c.name === sub);
        if (!health) { health = { name: sub, status: "healthy", avgLatencyMs: 0, avgTokenCost: 0, successRate: 1, usageCount: 0, errorCount: 0, lastError: "", lastUsedAt: "", consecutiveFailures: 0 }; s.subsystemHealth.push(health); }
        health.usageCount++;
        health.avgLatencyMs = Math.round((health.avgLatencyMs * (health.usageCount - 1) + actual.durationMs) / health.usageCount);
        health.avgTokenCost = Math.round((health.avgTokenCost * (health.usageCount - 1) + actual.tokensUsed / actual.subsystemsUsed.length) / health.usageCount);
        if (actual.outcome === "success") {
          health.successRate = Math.min(1, health.successRate + 0.05);
          health.consecutiveFailures = 0;
          health.status = "healthy";
        } else {
          health.successRate = Math.max(0, health.successRate - 0.1);
          health.errorCount++;
          health.consecutiveFailures++;
          if (health.consecutiveFailures >= 3) health.status = "critical";
          else if (health.consecutiveFailures >= 1) health.status = "degraded";
        }
        health.lastUsedAt = new Date().toISOString();
      }

      // Update global success rate
      const allDecisions = s.decisions;
      s.globalSuccessRate = allDecisions.filter(d => d.outcome === "success").length / allDecisions.length;

      // Auto mode switching
      if (s.config.autoRecovery) {
        if (s.globalSuccessRate < 0.5 && s.config.mode !== "recovery") {
          s.config.mode = "recovery";
          s.modeHistory.push({ mode: "recovery", reason: `Global success rate dropped to ${(s.globalSuccessRate * 100).toFixed(0)}%`, timestamp: new Date().toISOString() });
          s.alerts.push({ id: randomUUID(), subsystem: "meta-controller", level: "critical", message: `Switched to recovery mode — success rate ${(s.globalSuccessRate * 100).toFixed(0)}%`, timestamp: new Date().toISOString(), acknowledged: false });
        } else if (s.globalSuccessRate > 0.8 && s.config.mode === "recovery") {
          s.config.mode = "normal";
          s.modeHistory.push({ mode: "normal", reason: "Success rate recovered above 80%", timestamp: new Date().toISOString() });
        }
      }
    });

    return decision;
  }

  // ═══ Alt Sistem Sağlık Raporu ═══
  async getSubsystemHealth(): Promise<SubsystemHealth[]> {
    const s = await this.store.read();
    return s.subsystemHealth;
  }

  // ═══ Uyarılar ═══
  async getAlerts(unacknowledgedOnly = true): Promise<SystemAlert[]> {
    const s = await this.store.read();
    return unacknowledgedOnly ? s.alerts.filter(a => !a.acknowledged) : s.alerts;
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    await this.store.mutate(s => { const a = s.alerts.find(x => x.id === alertId); if (a) a.acknowledged = true; });
  }

  // ═══ İçgörüler ═══
  async generateInsights(): Promise<MetaInsight[]> {
    return await this.store.mutate(s => {
      const insights: MetaInsight[] = [];

      // Pattern: En çok kullanılan alt sistemler
      const topSystems = [...s.subsystemHealth].sort((a, b) => b.usageCount - a.usageCount).slice(0, 3);
      if (topSystems.length) insights.push({ id: randomUUID(), category: "pattern", insight: `Most used subsystems: ${topSystems.map(t => `${t.name} (${t.usageCount}x)`).join(", ")}`, confidence: 0.9, impact: "low", subsystems: topSystems.map(t => t.name), timestamp: new Date().toISOString() });

      // Anomaly: Düşük başarı oranlı sistemler
      const degraded = s.subsystemHealth.filter(h => h.successRate < 0.5 && h.usageCount > 3);
      if (degraded.length) insights.push({ id: randomUUID(), category: "anomaly", insight: `Degraded subsystems detected: ${degraded.map(d => `${d.name} (${(d.successRate * 100).toFixed(0)}%)`).join(", ")}`, confidence: 0.85, impact: "high", subsystems: degraded.map(d => d.name), timestamp: new Date().toISOString() });

      // Optimization: Kullanılmayan sistemler
      const unused = s.subsystemHealth.filter(h => h.usageCount === 0);
      if (unused.length) insights.push({ id: randomUUID(), category: "recommendation", insight: `${unused.length} subsystems never used — consider integration or removal`, confidence: 0.7, impact: "medium", subsystems: unused.map(u => u.name), timestamp: new Date().toISOString() });

      // Risk: Art arda başarısızlıklar
      const failing = s.subsystemHealth.filter(h => h.consecutiveFailures >= 2);
      if (failing.length) insights.push({ id: randomUUID(), category: "risk", insight: `Consecutive failures in: ${failing.map(f => `${f.name} (${f.consecutiveFailures}x)`).join(", ")}`, confidence: 0.95, impact: "high", subsystems: failing.map(f => f.name), timestamp: new Date().toISOString() });

      s.insights.push(...insights);
      return insights;
    });
  }

  // ═══ Mod Değişikliği ═══
  async setMode(mode: MetaMode, reason: string): Promise<void> {
    await this.store.mutate(s => {
      s.config.mode = mode;
      s.modeHistory.push({ mode, reason, timestamp: new Date().toISOString() });
    });
  }

  // ═══ Yapılandırma ═══
  async getConfig(): Promise<MetaConfig> {
    const s = await this.store.read();
    return s.config;
  }

  async updateConfig(partial: Partial<MetaConfig>): Promise<void> {
    await this.store.mutate(s => {
      if (partial.mode !== undefined) s.config.mode = partial.mode;
      if (partial.maxConcurrentSubsystems !== undefined) s.config.maxConcurrentSubsystems = partial.maxConcurrentSubsystems;
      if (partial.healthCheckIntervalMs !== undefined) s.config.healthCheckIntervalMs = partial.healthCheckIntervalMs;
      if (partial.autoRecovery !== undefined) s.config.autoRecovery = partial.autoRecovery;
      if (partial.learningRate !== undefined) s.config.learningRate = partial.learningRate;
      if (partial.explorationRate !== undefined) s.config.explorationRate = partial.explorationRate;
    });
  }

  // ═══ İstatistikler ═══
  async getStats(tenantId: string) {
    const s = await this.store.read();
    const td = s.decisions.filter(d => d.tenantId === tenantId);
    const avgEff = td.length ? td.reduce((sum, d) => sum + d.efficiency, 0) / td.length : 0;
    const successRate = td.length ? td.filter(d => d.outcome === "success").length / td.length : 0;
    const byComplexity: Record<string, { count: number; totalDuration: number; successes: number }> = {};
    for (const d of td) {
      const c = d.profile.complexity;
      if (!byComplexity[c]) byComplexity[c] = { count: 0, totalDuration: 0, successes: 0 };
      byComplexity[c]!.count++;
      byComplexity[c]!.totalDuration += d.actualDurationMs;
      if (d.outcome === "success") byComplexity[c]!.successes++;
    }
    const bcResult: Record<string, { count: number; avgDuration: number; successRate: number }> = {};
    for (const [k, v] of Object.entries(byComplexity)) bcResult[k] = { count: v.count, avgDuration: Math.round(v.totalDuration / v.count), successRate: auroraRound(v.successes / v.count) };

    const suggestions: string[] = [];
    if (avgEff > 1.5) suggestions.push("Plans underestimate duration — increase timeouts");
    if (successRate < 0.7) suggestions.push("Success rate below 70% — review failure patterns");
    const degraded = s.subsystemHealth.filter(h => h.status !== "healthy");
    if (degraded.length) suggestions.push(`${degraded.length} subsystems need attention: ${degraded.map(d => d.name).join(", ")}`);
    if (s.config.mode === "recovery") suggestions.push("System in recovery mode — investigate root causes");

    return {
      // Meta-controller genel
      currentMode: s.config.mode,
      cycleCount: s.cycleCount,
      totalSystemActivations: s.totalSystemActivations,
      globalSuccessRate: auroraRound(s.globalSuccessRate),
      // Karar istatistikleri
      totalDecisions: td.length,
      avgEfficiency: auroraRound(avgEff),
      successRate: auroraRound(successRate),
      byComplexity: bcResult,
      // Alt sistem sağlığı
      subsystemHealth: s.subsystemHealth,
      healthyCount: s.subsystemHealth.filter(h => h.status === "healthy").length,
      degradedCount: s.subsystemHealth.filter(h => h.status === "degraded").length,
      criticalCount: s.subsystemHealth.filter(h => h.status === "critical").length,
      // Uyarılar ve içgörüler
      activeAlerts: s.alerts.filter(a => !a.acknowledged).length,
      totalInsights: s.insights.length,
      // Optimizasyon
      optimizationSuggestions: suggestions,
      topSubsystems: s.subsystemHealth.sort((a, b) => b.usageCount - a.usageCount).slice(0, 10),
      // Mod geçmişi
      modeHistory: s.modeHistory.slice(-10),
      // Tüm30alt sistem listesi
      registeredSubsystems: ALL_SUBSYSTEMS.length,
    };
  }

  // ═══ Sync helper ═══
  getSubsystemCosts(): SubsystemHealth[] { return []; }

  // ═══════════════════════════════════════════════
  // RUN — Gerçek Cognitive Lifecycle Orkestrasyonu
  // ═══════════════════════════════════════════════

  /**
   * Ana görev çalıştırıcı. Bu method:
   *   1. Görevi profile eder
   *   2. Execution plan oluşturur
   *   3. Her phase'i sırayla çalıştırır
   *   4. Sonuçları kaydeder
   *   5. Deneyim çıkarır
   *
   * @param tenantId - Kiracı kimliği
   * @param taskDescription - Görev açıklaması
   * @param cognitiveState - Birleşik bilişsel durum
   * @param executors - Her subsystem için çalıştırıcı fonksiyonlar
   * @returns Çalıştırma sonucu
   */
  async run(
    tenantId: string,
    taskDescription: string,
    executors: SubsystemExecutors,
  ): Promise<RunResult> {
    const startTime = Date.now();
    const traceId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 1. Profile
    const profile = await this.profileTask(tenantId, taskDescription);
    const plan = this.createPlan(profile);

    // CognitiveState modunu ayarla
    executors.onPhaseChange?.("observing", `Task profiled: ${profile.complexity}`);

    const subsystemsUsed: string[] = [];
    const phaseResults: PhaseResult[] = [];
    let outcome: "success" | "failure" | "partial" = "success";

    // 2. Her phase'i çalıştır
    for (const phase of plan.phases) {
      executors.onPhaseChange?.(
        this.phaseToCognitiveMode(phase.name),
        `Phase: ${phase.name} — ${phase.subsystems.join(", ")}`,
      );

      const phaseStart = Date.now();
      const phaseResult: PhaseResult = {
        phaseName: phase.name,
        subsystems: phase.subsystems,
        durationMs: 0,
        successes: 0,
        failures: 0,
        outputs: [],
      };

      // Subsystem'leri paralel veya seri çalıştır
      if (phase.parallel) {
        const results = await Promise.allSettled(
          phase.subsystems.map(sub => this.executeSubsystem(sub, executors, tenantId, taskDescription, traceId))
        );
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          subsystemsUsed.push(phase.subsystems[i]!);
          if (r.status === "fulfilled") {
            phaseResult.successes++;
            phaseResult.outputs.push(r.value);
          } else {
            phaseResult.failures++;
            outcome = outcome === "success" ? "partial" : outcome;
          }
        }
      } else {
        for (const sub of phase.subsystems) {
          try {
            const output = await this.executeSubsystem(sub, executors, tenantId, taskDescription, traceId);
            subsystemsUsed.push(sub);
            phaseResult.successes++;
            phaseResult.outputs.push(output);
          } catch {
            subsystemsUsed.push(sub);
            phaseResult.failures++;
            if (!phase.optional) outcome = "failure";
          }
        }
      }

      phaseResult.durationMs = Date.now() - phaseStart;
      phaseResults.push(phaseResult);

      // Early exit kontrolü
      if (phase.earlyExitIf && phaseResult.outputs.some(o => typeof o === "string" && o.includes(phase.earlyExitIf))) {
        break;
      }
    }

    const totalDuration = Date.now() - startTime;

    // 3. Sonucu kaydet
    const decision = await this.recordDecision(tenantId, profile.id, profile, plan, {
      durationMs: totalDuration,
      tokensUsed: profile.estimatedTokens,
      subsystemsUsed,
      outcome,
    });

    executors.onPhaseChange?.(
      outcome === "success" ? "idle" : "recovering",
      `Task ${outcome} in ${totalDuration}ms — ${subsystemsUsed.length} subsystems used`,
    );

    return {
      traceId,
      profile,
      plan,
      phaseResults,
      decision,
      totalDurationMs: totalDuration,
      outcome,
      subsystemsUsed,
    };
  }

  /**
   * Tek bir alt sistemi çalıştır.
   */
  private async executeSubsystem(
    subsystem: string,
    executors: SubsystemExecutors,
    tenantId: string,
    taskDescription: string,
    traceId: string,
  ): Promise<string> {
    const executor = executors[subsystem];
    if (!executor) {
      return `[${subsystem}] no executor — skipped`;
    }
    const result = await (executor as (tenantId: string, task: string, traceId: string) => Promise<string>)(tenantId, taskDescription, traceId);
    return result ?? `[${subsystem}] completed`;
  }

  /**
   * Phase adını CognitiveMode'a çevir.
   */
  private phaseToCognitiveMode(phaseName: string): string {
    if (phaseName.includes("Observe")) return "observing";
    if (phaseName.includes("Analyze")) return "reasoning";
    if (phaseName.includes("Plan")) return "planning";
    if (phaseName.includes("Verify")) return "verifying";
    if (phaseName.includes("Execute")) return "executing";
    if (phaseName.includes("Learn")) return "learning";
    return "idle";
  }

  // ═══ P2: Explainability ═══

  async why(tenantId: string, traceId: string): Promise<{
    taskSummary: string; selectedProfile: string; subsystemsUsed: string[];
    rationale: string[]; phaseBreakdown: Array<{ phase: string; subsystems: string[]; outcome: string }>;
    decisionFactors: string[];
  }> {
    const s = await this.store.read();
    const run = s.decisions.find((x: any) => x.tenantId === tenantId && (x.traceId === traceId || x.id === traceId));
    if (!run) throw new Error("Aurora trace not found");
    const rationale = [`Profile: ${run.profile?.complexity ?? "unknown"} complexity`, `Subsystems: ${(run.actualSubsystemsUsed ?? []).join(", ")}`];
    const phaseBreakdown = (run.plan?.phases ?? []).map((ph: any) => ({ phase: ph.name, subsystems: ph.subsystems, outcome: "executed" }));
    const decisionFactors = [`Outcome: ${run.outcome}`, `Efficiency: ${run.efficiency}`];
    return { taskSummary: run.profile?.taskDescription ?? "unknown", selectedProfile: run.profile?.complexity ?? "unknown", subsystemsUsed: run.actualSubsystemsUsed ?? [], rationale, phaseBreakdown, decisionFactors };
  }
}

// ═══ Run Types ═══

export interface SubsystemExecutors {
  /** Her subsystem için çalıştırıcı. Key = subsystem adı, value = async fonksiyon */
  [subsystem: string]: ((tenantId: string, task: string, traceId: string) => Promise<string>) | ((mode: string, description: string) => void) | undefined;
  /** Phase değişikliğinde çağrılır */
  onPhaseChange?: (mode: string, description: string) => void;
}

export interface PhaseResult {
  phaseName: string;
  subsystems: string[];
  durationMs: number;
  successes: number;
  failures: number;
  outputs: string[];
}

export interface RunResult {
  traceId: string;
  profile: TaskProfile;
  plan: ExecutionPlan;
  phaseResults: PhaseResult[];
  decision: MetaDecision;
  totalDurationMs: number;
  outcome: "success" | "failure" | "partial";
  subsystemsUsed: string[];
}
