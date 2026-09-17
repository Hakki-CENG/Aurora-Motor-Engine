/**
 * Unified Cognitive Runtime Routes
 * EventBus, CognitiveState, Memory/Reasoning/Planning/Attention/Learning/ModelSelection Engines, runTask
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import type { HybridAgentEngine } from "@haf/engine";

export function registerCognitiveRoutes(app: FastifyInstance, engine: HybridAgentEngine, z: typeof import("zod").z, auroraTenant: z.ZodObject<any>) {

  // ═══ EventBus ═══
  app.get("/v1/event-bus/stats", async () => { return engine.eventBus.getStats(); });
  app.get("/v1/event-bus/events", async (request) => { const q = z.object({ count: z.coerce.number().default(50), type: z.string().optional() }).parse(request.query); return { events: engine.eventBus.getRecentEvents(q.count, q.type) }; });
  app.get("/v1/event-bus/trace/:traceId", async (request) => { const { traceId } = z.object({ traceId: z.string() }).parse(request.params); return { events: engine.eventBus.getTrace(traceId) }; });

  // ═══ CognitiveState ═══
  app.get("/v1/cognitive-state", async () => { return engine.cognitiveState.snapshot(); });
  app.get("/v1/cognitive-state/history", async () => { return { history: engine.cognitiveState.getModeHistory() }; });
  app.post("/v1/cognitive-state/reset", async () => { engine.cognitiveState.reset(); return { ok: true }; });

  // ═══ Memory Engine ═══
  app.post("/v1/memory/recall", async (request) => {
    const b = z.object({ tenantId: z.string().default("local"), text: z.string(), limit: z.number().optional() }).parse(request.body);
    const q: { text: string; tenantId: string; limit?: number | undefined } = { text: b.text, tenantId: b.tenantId };
    if (b.limit !== undefined) q.limit = b.limit;
    return await engine.memoryEngine.recall(q);
  });
  app.post("/v1/memory/store", async (request) => {
    const b = z.object({ tenantId: z.string().default("local"), content: z.string(), importance: z.number(), category: z.string().default("general") }).parse(request.body);
    return await engine.memoryEngine.store(b.tenantId, b.content, b.importance, b.category);
  });

  // ═══ Reasoning Engine ═══
  app.post("/v1/reasoning/reason", async (request) => {
    const b = z.object({ tenantId: z.string().default("local"), question: z.string(), context: z.string().default("") }).parse(request.body);
    return await engine.reasoningEngine.reason(b);
  });

  // ═══ Planning Engine ═══
  app.post("/v1/planning/plan", async (request) => {
    const b = z.object({ tenantId: z.string().default("local"), goal: z.string(), strategy: z.string().optional() }).parse(request.body);
    const q: { goal: string; tenantId: string; strategy?: string | undefined } = { goal: b.goal, tenantId: b.tenantId };
    if (b.strategy !== undefined) q.strategy = b.strategy;
    return await engine.planningEngine.plan(q);
  });

  // ═══ Attention Engine ═══
  app.get("/v1/attention/targets", async (request) => {
    const q = z.object({ tenantId: z.string().default("local"), limit: z.coerce.number().default(5) }).parse(request.query);
    return { targets: await engine.attentionEngine.getFocusTargets(q.tenantId, q.limit) };
  });

  // ═══ Learning Engine ═══
  app.post("/v1/learning/learn", async (request) => {
    const b = z.object({ tenantId: z.string().default("local"), experience: z.string(), outcome: z.enum(["success","failure","neutral"]), context: z.string().default(""), source: z.string().default("api") }).parse(request.body);
    return await engine.learningEngine.learn(b);
  });
  app.post("/v1/learning/consolidate", async (request) => {
    const b = auroraTenant.parse(request.body ?? {});
    return await engine.learningEngine.consolidate(b.tenantId);
  });

  // ═══ Model Selection Engine ═══
  app.post("/v1/model-selection/select", async (request) => {
    const b = z.object({ tenantId: z.string().default("local"), taskDescription: z.string(), strategy: z.enum(["performance","cost","quality","balanced"]).default("balanced") }).parse(request.body);
    return await engine.modelSelectionEngine.select(b);
  });

  // ═══ runTask — Ana Cognitive Lifecycle Entry Point ═══
  app.post("/v1/run-task", async (request) => {
    const b = z.object({ tenantId: z.string().default("local"), task: z.string() }).parse(request.body);
    return await engine.runTask(b.tenantId, b.task);
  });
}
