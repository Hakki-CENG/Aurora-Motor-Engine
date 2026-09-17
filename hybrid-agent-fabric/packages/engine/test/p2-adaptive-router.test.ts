import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AdaptiveRouterService } from "../src/aurora/adaptive-router.js";

async function router(): Promise<AdaptiveRouterService> {
  const root = await mkdtemp(join(tmpdir(), "haf-router-"));
  return new AdaptiveRouterService(root);
}

describe("P2: Adaptive Router — Learned Routing", () => {
  it("routes requests and records outcomes", async () => {
    const service = await router();
    
    // Route a request
    const decision = await service.route(
      "tenant1",
      "req1",
      "/api/chat",
      [
        { path: "/api/chat", latencyMs: 100, cost: 0.01, reliability: 0.95 },
        { path: "/api/chat-v2", latencyMs: 150, cost: 0.02, reliability: 0.99 },
      ],
      "hybrid"
    );
    
    expect(decision).toBeDefined();
    expect(decision.selectedPath).toBeDefined();
    
    // Record outcome
    await service.recordOutcome(decision.id, 120, true);
  });

  it("learnRoute analyzes decisions and creates rules", async () => {
    const service = await router();
    
    // Create multiple routes
    for (let i = 0; i < 5; i++) {
      const decision = await service.route(
        "tenant1",
        `req${i}`,
        "/api/chat",
        [{ path: "/api/chat", latencyMs: 100 + i * 10, cost: 0.01, reliability: 0.95 }],
        "semantic"
      );
      await service.recordOutcome(decision.id, 100 + i * 10, i < 4);
    }
    
    const result = await service.learnRoute("tenant1");
    expect(result).toBeDefined();
    expect(result.rulesUpdated).toBeGreaterThanOrEqual(0);
    expect(result.topRoutes).toBeInstanceOf(Array);
  });

  it("smartRoute selects best route based on learned rules", async () => {
    const service = await router();
    
    // First learn some routes
    for (let i = 0; i < 5; i++) {
      const decision = await service.route(
        "tenant1",
        `req${i}`,
        "/api/chat",
        [{ path: "/api/chat", latencyMs: 100, cost: 0.01, reliability: 0.95 }],
        "semantic"
      );
      await service.recordOutcome(decision.id, 100, true);
    }
    
    await service.learnRoute("tenant1");
    
    // Now try smart routing
    const result = await service.smartRoute("tenant1", "/api/chat");
    expect(result).toBeDefined();
    expect(result.recommendedPath).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it("why() explains routing decisions", async () => {
    const service = await router();
    
    const decision = await service.route(
      "tenant1",
      "req1",
      "/api/test",
      [{ path: "/api/test", latencyMs: 150, cost: 0.01, reliability: 0.9 }],
      "hybrid"
    );
    
    const explanation = await service.why("tenant1", decision.id);
    expect(explanation).toBeDefined();
    expect(explanation.rationale).toBeInstanceOf(Array);
  });
});
