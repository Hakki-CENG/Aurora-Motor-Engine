import { z } from "zod";
import type { LifecycleHookService } from "../policy/lifecycle-hooks.js";
import type { ProjectInstructionService } from "../knowledge/project-instructions.js";
import { auroraDefined } from "../util/aurora-state.js";
import { defineCapability } from "./schema.js";

const lifecycleEvent = z.enum(["session.start", "session.stop", "prompt.submit", "tool.pre", "tool.post"]);
const lifecycleAction = z.enum(["allow", "warn", "require_approval", "deny"]);

/** Repository-provided house rules: discovered, screened, budgeted and auditable. */
export function projectInstructionCapabilities(service: ProjectInstructionService) {
  return [
    defineCapability(
      { id: "project.instructions", version: "1.0.0", description: "Discover AGENTS.md, CLAUDE.md, AURORA.md, .cursorrules and copilot-instructions in the workspace, with injection screening and precedence.", risk: "workspace_read", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, ctx) => await service.scan(ctx.workspacePath),
    ),
    defineCapability(
      { id: "project.instructions.project", version: "1.0.0", description: "Render the screened repository instructions into one character-budgeted block with per-file digests.", risk: "workspace_read", sideEffect: false, source: "core" },
      z.object({ characterBudget: z.number().int().min(0).max(60_000).optional() }),
      async (input, ctx) => await service.project(auroraDefined({ workspacePath: ctx.workspacePath, characterBudget: input.characterBudget })),
    ),
  ];
}

/**
 * Deterministic lifecycle hooks. Defining and toggling rules changes what the engine will refuse, so
 * those are privileged; reading the rules and the firing ledger is pure.
 */
export function lifecycleHookCapabilities(service: LifecycleHookService) {
  return [
    defineCapability(
      { id: "hooks.list", version: "1.0.0", description: "List the deterministic lifecycle hook rules for this tenant.", risk: "pure", sideEffect: false, source: "core" },
      z.object({ event: lifecycleEvent.optional() }),
      async (input, ctx) => ({ rules: await service.rules(ctx.tenantId, input.event) }),
    ),
    defineCapability(
      { id: "hooks.define", version: "1.0.0", description: "Define or replace a lifecycle hook rule that can warn, require approval or deny at the capability boundary.", risk: "privileged", sideEffect: true, source: "core" },
      z.object({
        id: z.string().max(100).optional(),
        event: lifecycleEvent,
        description: z.string().min(1).max(500),
        action: lifecycleAction,
        reason: z.string().min(1).max(500),
        capabilityIds: z.array(z.string().min(1).max(200)).max(50).optional(),
        argumentPattern: z.string().max(500).optional(),
        runCapability: z.object({ capabilityId: z.string().min(1).max(200), input: z.record(z.unknown()).optional() }).optional(),
        priority: z.number().int().min(1).max(1000).optional(),
        enabled: z.boolean().optional(),
      }),
      async (input, ctx) => {
        const { runCapability, ...rest } = input;
        return await service.define(auroraDefined({
          tenantId: ctx.tenantId, ...rest,
          ...(runCapability ? { runCapability: { capabilityId: runCapability.capabilityId, input: (runCapability.input ?? {}) as Record<string, unknown> } } : {}),
        }));
      },
    ),
    defineCapability(
      { id: "hooks.enabled", version: "1.0.0", description: "Enable or disable one lifecycle hook rule.", risk: "privileged", sideEffect: true, source: "core" },
      z.object({ ruleId: z.string().min(1).max(200), enabled: z.boolean() }),
      async (input, ctx) => await service.setEnabled(ctx.tenantId, input.ruleId, input.enabled),
    ),
    defineCapability(
      { id: "hooks.remove", version: "1.0.0", description: "Remove a lifecycle hook rule.", risk: "privileged", sideEffect: true, source: "core" },
      z.object({ ruleId: z.string().min(1).max(200) }),
      async (input, ctx) => await service.remove(ctx.tenantId, input.ruleId),
    ),
    defineCapability(
      { id: "hooks.firings", version: "1.0.0", description: "The durable record of which hook fired on what, and what its action did.", risk: "pure", sideEffect: false, source: "core" },
      z.object({ limit: z.number().int().min(1).max(1000).optional() }),
      async (input, ctx) => ({ firings: await service.firings(ctx.tenantId, input.limit ?? 50) }),
    ),
    defineCapability(
      { id: "hooks.config", version: "1.0.0", description: "Read or change hook enablement and the allowlist of capabilities a hook action may invoke.", risk: "privileged", sideEffect: true, source: "core" },
      z.object({ enabled: z.boolean().optional(), allowCapabilityActions: z.boolean().optional(), actionAllowlist: z.array(z.string().min(1).max(200)).max(50).optional() }),
      async (input, ctx) => Object.keys(input).length
        ? await service.configure(auroraDefined({ tenantId: ctx.tenantId, ...input }))
        : await service.config(ctx.tenantId),
    ),
  ];
}
