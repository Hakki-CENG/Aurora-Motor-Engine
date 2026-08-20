import { z } from "zod";
import type { Supervisor } from "../runtime/supervisor.js";
import { defineCapability } from "./schema.js";

export function agentCapabilities(supervisor: Supervisor) {
  return [
    defineCapability(
      {
        id: "agent.spawn",
        version: "1.0.0",
        description: "Admit a persistent child agent in an isolated worktree/copy and return its handle immediately.",
        risk: "process",
        sideEffect: true,
        source: "core",
      },
      z.object({ task: z.string().min(1).max(100_000), name: z.string().max(100).optional() }),
      async ({ task, name }, context) => {
        const child = await supervisor.spawnChild({
          parentSessionId: context.sessionId,
          task,
          ...(name ? { name } : {}),
          source: "agent",
          insideParentTurn: true,
        });
        return {
          childSessionId: child.sessionId,
          familyId: child.familyId,
          name: child.name,
          workspacePath: child.workspacePath,
          status: child.status,
        };
      },
    ),
    defineCapability(
      {
        id: "agent.fanout",
        version: "1.0.0",
        description: "This session's child-agent budget: nesting depth, live and lifetime children, the limits in force, and whether another spawn would be accepted.",
        risk: "pure",
        sideEffect: false,
        source: "core",
      },
      z.object({}),
      // An agent that can see the limit can plan within it instead of discovering it by failing.
      async (_input, context) => await supervisor.fanoutStatus(context.sessionId),
    ),
    defineCapability(
      { id: "agent.list", version: "1.0.0", description: "List the current tenant's active and saved agents.", risk: "pure", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, context) => ({ sessions: await supervisor.listSessions(context.tenantId) }),
    ),
    defineCapability(
      { id: "agent.roster", version: "1.0.0", description: "List only directly reachable parent, sibling and child agents with relationship and status.", risk: "pure", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, context) => ({ currentSessionId: context.sessionId, agents: await supervisor.familyRoster(context.sessionId) }),
    ),
    defineCapability(
      {
        id: "agent.send",
        version: "2.0.0",
        description: "Send a rate-limited durable message within direct family reach. Supports auto, steer, follow_up and family-scoped broadcast delivery.",
        risk: "pure",
        sideEffect: true,
        source: "core",
      },
      z.object({
        message: z.string().min(1).max(16_384),
        mode: z.enum(["auto", "steer", "follow_up"]).default("auto"),
        targetSessionId: z.string().min(1).optional(),
        receiverRole: z.enum(["parent", "sibling", "child"]).optional(),
        receiverName: z.string().min(1).max(200).optional(),
        broadcast: z.boolean().default(false),
      }),
      async ({ targetSessionId, receiverRole, receiverName, broadcast, message, mode }, context) =>
        await supervisor.sendAgentMessage({
          senderSessionId: context.sessionId,
          message,
          mode,
          ...(targetSessionId ? { targetSessionId } : {}),
          ...(receiverRole ? { receiverRole } : {}),
          ...(receiverName ? { receiverName } : {}),
          broadcast,
        }),
    ),
  ];
}
