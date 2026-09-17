import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CausalGraphService } from "../src/aurora/causal-graph.js";

async function causalGraph(): Promise<CausalGraphService> {
  const root = await mkdtemp(join(tmpdir(), "haf-causal-"));
  return new CausalGraphService(root);
}

describe("P2: Causal Graph — Impact Analysis", () => {
  it("adds nodes and edges to the graph", async () => {
    const service = await causalGraph();
    
    const node1 = await service.addNode("API Latency", "metric", "Response time for API calls");
    const node2 = await service.addNode("User Satisfaction", "outcome", "How satisfied users are");
    
    const edge = await service.addEdge(node1.id, node2.id, "causes", 0.8, 0.9);
    expect(edge).toBeDefined();
    expect(edge.fromId).toBe(node1.id);
    expect(edge.toId).toBe(node2.id);
  });

  it("finds paths between nodes", async () => {
    const service = await causalGraph();
    
    const n1 = await service.addNode("Root Cause", "event", "Initial event");
    const n2 = await service.addNode("Intermediate", "event", "Middle event");
    const n3 = await service.addNode("Effect", "outcome", "Final effect");
    
    await service.addEdge(n1.id, n2.id, "causes", 0.9, 0.8);
    await service.addEdge(n2.id, n3.id, "causes", 0.7, 0.9);
    
    const paths = await service.findPaths(n1.id, n3.id);
    expect(paths).toBeInstanceOf(Array);
  });

  it("analyzes impact of a node", async () => {
    const service = await causalGraph();
    
    const root = await service.addNode("System Change", "event", "Major system change");
    const effect1 = await service.addNode("Performance", "metric", "System performance");
    const effect2 = await service.addNode("Reliability", "metric", "System reliability");
    
    await service.addEdge(root.id, effect1.id, "affects", 0.9, 0.8);
    await service.addEdge(root.id, effect2.id, "affects", 0.7, 0.9);
    
    const impact = await service.analyzeImpact(root.id);
    expect(impact).toBeDefined();
    expect(impact.node).toBeDefined();
    expect(impact.downstreamEffects).toBeInstanceOf(Array);
    expect(impact.riskLevel).toBeDefined();
    expect(impact.recommendations).toBeInstanceOf(Array);
  });

  it("provides getStats summary", async () => {
    const service = await causalGraph();
    
    const stats = await service.getStats();
    expect(stats).toBeDefined();
  });
});
