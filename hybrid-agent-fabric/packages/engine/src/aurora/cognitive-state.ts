/**
 * CognitiveState — Aurora Cognitive Runtime
 *
 * Tüm servislerin paylaştığı tek birleşik bilişsel durum.
 * Meta Controller bu state'i okuyarak karar verir.
 * Servisler bu state'i yazarak durumu günceller.
 */

export type CognitiveMode =
  | "idle"            // Görev yok
  | "observing"       // Girdi analiz ediliyor
  | "reasoning"       // Hipotez üretme / düşünme
  | "planning"        // Plan oluşturma
  | "executing"       // Plan çalıştırılıyor
  | "verifying"       // Sonuç doğrulanıyor
  | "learning"        // Deneyim çıkarılıyor
  | "recovering"      // Hata kurtarma
  | "consolidating";  // Bellek sıkıştırma / uyku

export type ConfidenceLevel = "speculative" | "uncertain" | "moderate" | "confident" | "verified";

export interface ActiveGoal {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  progress: number;
  status: "active" | "blocked" | "completed" | "failed";
  startedAt: number;
}

export interface ActivePlan {
  id: string;
  goalId: string;
  currentStep: number;
  totalSteps: number;
  status: "executing" | "adapted" | "failed" | "completed";
}

export interface ActiveHypothesis {
  id: string;
  statement: string;
  confidence: number;
  status: "proposed" | "testing" | "confirmed" | "rejected";
}

export interface ResourceBudget {
  tokensUsed: number;
  tokensRemaining: number;
  timeElapsedMs: number;
  timeBudgetMs: number;
  memoryOperations: number;
  toolCallsMade: number;
}

export interface AttentionFocus {
  category: string;
  target: string;
  urgency: number;
  importance: number;
  since: number;
}

export interface FailureContext {
  type: string;
  description: string;
  subsystem: string;
  timestamp: number;
  recoveryAttempted: boolean;
}

export interface CognitiveStateSnapshot {
  schemaVersion: number;

  /** Şu anki cognitive mod */
  mode: CognitiveMode;

  /** Aktif görev bilgisi */
  activeGoal: ActiveGoal | null;

  /** Aktif plan */
  activePlan: ActivePlan | null;

  /** Test edilen hipotezler */
  activeHypotheses: ActiveHypothesis[];

  /** Genel güven seviyesi */
  overallConfidence: ConfidenceLevel;

  /** Kaynak bütçesi */
  resourceBudget: ResourceBudget;

  /** Dikkat odağı */
  attentionFocus: AttentionFocus | null;

  /** Son hata bağlamı */
  lastFailure: FailureContext | null;

  /** Başarı oranı (son 20 görev) */
  recentSuccessRate: number;

  /** Aktif ajan sayısı */
  activeAgentCount: number;

  /** Aktif araç sayısı */
  activeToolCount: number;

  /** Bu session'daki toplam görev sayısı */
  totalTasksProcessed: number;

  /** Son mode değişikliği nedeni */
  lastModeChangeReason: string;

  /** Timestamp */
  lastUpdated: number;
}

const DEFAULT_STATE: CognitiveStateSnapshot = {
  schemaVersion: 1,
  mode: "idle",
  activeGoal: null,
  activePlan: null,
  activeHypotheses: [],
  overallConfidence: "moderate",
  resourceBudget: {
    tokensUsed: 0,
    tokensRemaining: 100000,
    timeElapsedMs: 0,
    timeBudgetMs: 120000,
    memoryOperations: 0,
    toolCallsMade: 0,
  },
  attentionFocus: null,
  lastFailure: null,
  recentSuccessRate: 1.0,
  activeAgentCount: 0,
  activeToolCount: 0,
  totalTasksProcessed: 0,
  lastModeChangeReason: "initial",
  lastUpdated: Date.now(),
};

/**
 * CognitiveState — In-memory unified state.
 *
 * DurableJsonState kullanmaz çünkü bu state sürekli değişir
 * ve persistence gerektirmez (rekonstrüksiyon yapılabilir).
 *
 * Thread-safe: Tek event loop'ta çalıştığı için race condition yok.
 */
export class CognitiveState {
  private state: CognitiveStateSnapshot;
  private history: Array<{ timestamp: number; mode: CognitiveMode; reason: string }> = [];

  constructor() {
    this.state = { ...DEFAULT_STATE };
  }

  /** Tüm state'i oku (snapshot) */
  snapshot(): CognitiveStateSnapshot {
    return { ...this.state };
  }

  /** Mode değiştir */
  setMode(mode: CognitiveMode, reason: string): void {
    const prev = this.state.mode;
    if (prev !== mode) {
      this.history.push({ timestamp: Date.now(), mode, reason });
      if (this.history.length > 200) {
        this.history = this.history.slice(-150);
      }
    }
    this.state.mode = mode;
    this.state.lastModeChangeReason = reason;
    this.state.lastUpdated = Date.now();
  }

  getMode(): CognitiveMode {
    return this.state.mode;
  }

  /** Aktif hedefi ayarla */
  setActiveGoal(goal: ActiveGoal | null): void {
    this.state.activeGoal = goal;
    this.state.lastUpdated = Date.now();
  }

  /** Aktif planı ayarla */
  setActivePlan(plan: ActivePlan | null): void {
    this.state.activePlan = plan;
    this.state.lastUpdated = Date.now();
  }

  /** Hipotez ekle/güncelle */
  updateHypothesis(h: ActiveHypothesis): void {
    const idx = this.state.activeHypotheses.findIndex(x => x.id === h.id);
    if (idx >= 0) {
      this.state.activeHypotheses[idx] = h;
    } else {
      this.state.activeHypotheses.push(h);
    }
    // Tamamlanan hipotezleri temizle
    this.state.activeHypotheses = this.state.activeHypotheses.filter(
      x => x.status === "proposed" || x.status === "testing"
    );
    this.state.lastUpdated = Date.now();
  }

  /** Kaynak bütçesini güncelle */
  updateBudget(delta: Partial<ResourceBudget>): void {
    Object.assign(this.state.resourceBudget, delta);
    this.state.lastUpdated = Date.now();
  }

  /** Dikkat odağını değiştir */
  setAttentionFocus(focus: AttentionFocus | null): void {
    this.state.attentionFocus = focus;
    this.state.lastUpdated = Date.now();
  }

  /** Güven seviyesini güncelle */
  setConfidence(level: ConfidenceLevel): void {
    this.state.overallConfidence = level;
    this.state.lastUpdated = Date.now();
  }

  /** Hata bağlamını kaydet */
  recordFailure(failure: FailureContext): void {
    this.state.lastFailure = failure;
    this.state.lastUpdated = Date.now();
  }

  /** Başarı oranını güncelle */
  updateSuccessRate(success: boolean): void {
    // Basit exponential moving average
    const alpha = 0.15;
    const current = this.state.recentSuccessRate;
    this.state.recentSuccessRate = current * (1 - alpha) + (success ? 1 : 0) * alpha;
    this.state.totalTasksProcessed++;
    this.state.lastUpdated = Date.now();
  }

  /** Ajan/tool sayılarını güncelle */
  setActiveCounts(agents: number, tools: number): void {
    this.state.activeAgentCount = agents;
    this.state.activeToolCount = tools;
    this.state.lastUpdated = Date.now();
  }

  /** Mode geçmişini getir */
  getModeHistory(): Array<{ timestamp: number; mode: CognitiveMode; reason: string }> {
    return [...this.history];
  }

  /** State'i sıfırla (yeni session) */
  reset(): void {
    this.state = { ...DEFAULT_STATE };
    this.history = [];
  }

  getStats() {
    return { currentMode: this.state.mode, historyLength: this.history.length, lastChange: this.history.length > 0 ? this.history[this.history.length - 1] : null };
  }

  // ═══ P3: Explainability ═══

  async why(tenantId: string, entityId: string): Promise<{
    entity: string; summary: string;
    rationale: string[]; details: Record<string, unknown>;
  }> {
    return { entity: entityId, summary: "N/A", rationale: ["Service does not support entity lookup"], details: {} };
  }
}

