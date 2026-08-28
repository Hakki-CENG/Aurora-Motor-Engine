import { join } from "node:path";
import { ThoughtCoreService } from "./thought-core-service.js";
import { ThoughtState, ThoughtPriority } from "./thought-core-service.js";

/**
 * Background Thinking Service - Arka planda düşünebilme sistemi.
 * 
 * Aurora boşta kaldığında:
 * - Hafızayı tarar
 * - Açık problemleri inceler
 * - Eski fikirleri değerlendirir
 * - Yeni bağlantılar arar
 * - Düşük öncelikli görevleri işler
 * 
 * Bu, Thought Loop Architecture'nın temel bir parçasıdır.
 */
export class BackgroundThinkingService {
  private readonly thoughtCore: ThoughtCoreService;
  private running: boolean = false;
  private threads: Map<string, { tenantId: string; startedAt: number }> = new Map();

  constructor(rootPath: string, thoughtCore?: ThoughtCoreService) {
    this.thoughtCore = thoughtCore ?? new ThoughtCoreService(rootPath);
  }

  /**
   * Arka planda düşünme döngüsünü çalıştır.
   * Bu, sürekli çalışan bir servistir.
   */
  async runCycle(tenantId: string, options?: {
    maxIterations?: number;
    maxDurationMs?: number;
    minPriority?: ThoughtPriority;
  }): Promise<{
    iteration: number;
    thoughtsProcessed: number;
    connectionsFound: number;
    problemsReviewed: number;
    hypothesesGenerated: number;
    totalDurationMs: number;
    nextRunInMs: number;
  }> {
    const maxIterations = options?.maxIterations ?? 3;
    const maxDurationMs = options?.maxDurationMs ?? 10000;
    const minPriority = options?.minPriority ?? "P3";

    const startTime = Date.now();
    let totalProcessed = 0;
    let totalConnections = 0;
    let totalProblemsReviewed = 0;
    let totalHypothesesGenerated = 0;

    const priorityOrder: ThoughtPriority[] = ["P0", "P1", "P2", "P3", "P4"];
    const minPriorityIndex = priorityOrder.indexOf(minPriority);

    // Sadece düşük öncelikli düşünceleri işle
    for (let i = 0; i < maxIterations; i++) {
      if (Date.now() - startTime > maxDurationMs) break;

      const result = await this.thoughtCore.runBackgroundThinking(tenantId, {
        maxThoughts: 20,
        maxDurationMs: maxDurationMs / maxIterations,
      });

      totalProcessed += result.thoughtsProcessed;
      totalConnections += result.newConnections;
      totalProblemsReviewed += result.problemsReviewed;
      totalHypothesesGenerated += result.hypothesesGenerated;
    }

    // Sonraki çalışma zamanını belirle (5-15 dakika arasında)
    const nextRunInMs = 5 * 60 * 1000 + Math.floor(Math.random() * 10 * 60 * 1000);

    return {
      iteration: maxIterations,
      thoughtsProcessed: totalProcessed,
      connectionsFound: totalConnections,
      problemsReviewed: totalProblemsReviewed,
      hypothesesGenerated: totalHypothesesGenerated,
      totalDurationMs: Date.now() - startTime,
      nextRunInMs,
    };
  }

  /**
   * Hafızayı tarayarak yeni bağlantılar bul.
   */
  async scanMemoryForConnections(tenantId: string, options?: {
    limit?: number;
    minSimilarity?: number;
  }): Promise<{
    connectionsFound: Array<{ thoughtId1: string; thoughtId2: string; similarity: number; commonTags: string[] }>;
    thoughtsScanned: number;
  }> {
    const limit = options?.limit ?? 100;
    const minSimilarity = options?.minSimilarity ?? 0.4;

    const thoughts = await this.thoughtCore.listThoughts(tenantId, { limit });
    const connections: Array<{ thoughtId1: string; thoughtId2: string; similarity: number; commonTags: string[] }> = [];

    for (let i = 0; i < thoughts.length; i++) {
      for (let j = i + 1; j < thoughts.length && j < i + 20; j++) {
        const thought1 = thoughts[i]!;
        const thought2 = thoughts[j]!;

        // Skip if already connected
        if (thought1.relatedThoughtIds.includes(thought2.id) || thought2.relatedThoughtIds.includes(thought1.id)) {
          continue;
        }

        // Calculate similarity based on tags
        const commonTags = thought1.tags.filter((tag) => thought2.tags.includes(tag));
        const allTags = [...new Set([...thought1.tags, ...thought2.tags])];
        const similarity = allTags.length > 0 ? commonTags.length / allTags.length : 0;

        if (similarity >= minSimilarity && commonTags.length >= 2) {
          connections.push({
            thoughtId1: thought1.id,
            thoughtId2: thought2.id,
            similarity,
            commonTags,
          });
        }
      }
    }

    return {
      connectionsFound: connections,
      thoughtsScanned: thoughts.length,
    };
  }

  /**
   * Eski fikirleri yeniden değerlendir.
   * Uzun süredir aktif olmayan düşünceleri kontrol et.
   */
  async reevaluateOldThoughts(tenantId: string, options?: {
    minAgeDays?: number;
    limit?: number;
  }): Promise<{
    thoughtsReevaluated: number;
    reactivated: number;
    archived: number;
  }> {
    const minAgeDays = options?.minAgeDays ?? 30;
    const limit = options?.limit ?? 50;
    const now = Date.now();

    const oldThoughts = await this.thoughtCore.listThoughts(tenantId, {
      limit,
    });

    const minAgeMs = minAgeDays * 86_400_000;
    let reevaluated = 0;
    let reactivated = 0;
    let archived = 0;

    for (const thought of oldThoughts) {
      const ageMs = now - Date.parse(thought.updatedAt);
      if (ageMs < minAgeMs) continue;

      reevaluated++;

      // Check if thought should be reactivated based on related activity
      const relatedThoughts = await this.thoughtCore.listThoughts(tenantId, {
        limit: 10,
      });

      const hasRecentRelated = relatedThoughts.some(
        (t) =>
          thought.relatedThoughtIds.includes(t.id) &&
          (now - Date.parse(t.updatedAt)) < minAgeMs / 2
      );

      if (hasRecentRelated && thought.state === "waiting") {
        await this.thoughtCore.activateThought(tenantId, thought.id);
        reactivated++;
      } else if (!hasRecentRelated && thought.state === "active" && thought.activationCount > 5) {
        await this.thoughtCore.setWaiting(tenantId, thought.id);
        archived++;
      }
    }

    return {
      thoughtsReevaluated: reevaluated,
      reactivated,
      archived,
    };
  }

  /**
   * Yeni araştırma fırsatları bul.
   */
  async findResearchOpportunities(tenantId: string, options?: {
    limit?: number;
  }): Promise<{
    opportunities: Array<{ title: string; reason: string; priority: ThoughtPriority }>;
    scanned: number;
  }> {
    const limit = options?.limit ?? 100;
    const opportunities: Array<{ title: string; reason: string; priority: ThoughtPriority }> = [];

    // 1. Check for thoughts with high importance but low confidence
    const highImportanceLowConfidence = await this.thoughtCore.listThoughts(tenantId, {
      minImportance: 0.8,
      limit,
    });

    for (const thought of highImportanceLowConfidence) {
      if (thought.confidence < 0.5 && thought.state !== "researching") {
        opportunities.push({
          title: `Investigate: ${thought.title}`,
          reason: `High importance (${thought.importance}) but low confidence (${thought.confidence})`,
          priority: thought.priority,
        });
      }
    }

    // 2. Check for open problems that need attention
    const problems = await this.thoughtCore.listOpenProblems(tenantId, {
      status: "open",
      limit: 20,
    });

    for (const problem of problems) {
      if (!problem.lastReviewedAt || (Date.now() - Date.parse(problem.lastReviewedAt)) > problem.reviewIntervalDays * 86_400_000) {
        opportunities.push({
          title: `Review: ${problem.title}`,
          reason: `Open problem needs review (last reviewed ${problem.lastReviewedAt || "never"})`,
          priority: problem.priority,
        });
      }
    }

    return {
      opportunities,
      scanned: highImportanceLowConfidence.length + problems.length,
    };
  }

  /**
   * Arka plan düşünme sistemini başlat.
   * Bu, sürekli çalışan bir arka plan görevidir.
   */
  async startBackgroundThread(tenantId: string): Promise<{
    threadId: string;
    message: string;
  }> {
    // In a real implementation, this would start a background thread
    // For now, we just run one cycle and return
    const result = await this.runCycle(tenantId);
    
    return {
      threadId: `bg-thread-${Date.now()}`,
      message: `Background thinking started. Processed ${result.thoughtsProcessed} thoughts in ${result.totalDurationMs}ms.`,
    };
  }

  /**
   * Arka plan düşünmesini durdur.
   */
  async stopBackgroundThread(threadId: string): Promise<{
    stopped: boolean;
    message: string;
  }> {
    // In a real implementation, this would stop the background thread
    return {
      stopped: true,
      message: `Background thinking thread ${threadId} stopped.`,
    };
  }

  /**
   * Arka plan düşünme durumunu getir.
   */
  async getStatus(tenantId: string): Promise<{
    isRunning: boolean;
    lastRunAt?: string;
    lastRunDurationMs: number;
    totalCycles: number;
    totalThoughtsProcessed: number;
    totalConnectionsFound: number;
  }> {
    // In a real implementation, this would track the background thread status
    return {
      isRunning: this.running,
      lastRunAt: new Date().toISOString(),
      lastRunDurationMs: 0,
      totalCycles: 0,
      totalThoughtsProcessed: 0,
      totalConnectionsFound: 0,
    };
  }

  /**
   * Arka plan düşünme servisini başlat.
   */
  start(): void {
    this.running = true;
  }

  /**
   * Arka plan düşünme servisini durdur.
   */
  stop(): void {
    this.running = false;
    this.threads.clear();
  }
}
