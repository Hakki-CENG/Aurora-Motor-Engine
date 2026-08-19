import { z } from "zod";
import type { MemoryStore } from "../memory/memory-store.js";
import { defineCapability } from "./schema.js";

export function memoryCapabilities(store: MemoryStore) {
  return [
    defineCapability(
      {
        id: "memory.search",
        version: "1.0.0",
        description: "Search active, tenant-scoped durable memories.",
        risk: "pure",
        sideEffect: false,
        source: "core",
      },
      z.object({ query: z.string(), limit: z.number().int().positive().max(20).optional() }),
      async ({ query, limit }, context) => ({
        memories: await store.search(context.tenantId, query, { sessionId: context.sessionId, ...(limit ? { limit } : {}) }),
      }),
    ),
    defineCapability(
      {
        id: "memory.propose",
        version: "1.0.0",
        description: "Create a session-scoped memory candidate with evidence; it is not globally active until promoted.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({
        kind: z.enum(["episodic", "semantic", "preference", "decision"]),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(5000),
        evidenceEventIds: z.array(z.string()).max(50).default([]),
      }),
      async ({ kind, title, content, evidenceEventIds }, context) =>
        await store.create({
          tenantId: context.tenantId,
          sessionId: context.sessionId,
          kind,
          scope: "session",
          title,
          content,
          evidenceEventIds,
          provenance: { createdBy: "agent" },
          status: "candidate",
        }),
    ),
  ];
}
