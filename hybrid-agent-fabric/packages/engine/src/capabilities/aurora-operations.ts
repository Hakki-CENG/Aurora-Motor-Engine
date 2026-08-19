import { z } from "zod";
import type { AuroraDataGovernanceService } from "../aurora/data-governance-service.js";
import type { AuroraMetricsCollector } from "../aurora/aurora-metrics.js";
import type { WorkspaceCheckpointService } from "../aurora/workspace-checkpoint-service.js";
import { auroraDefined } from "../util/aurora-state.js";
import { defineCapability } from "./schema.js";

/**
 * Operational Aurora surfaces: real workspace rollback, content-free telemetry and the data
 * governance operations (export, purge, integrity self-check) that keep a long-lived cognitive
 * system inspectable.
 */
export function checkpointCapabilities(service: WorkspaceCheckpointService) {
  return [
    defineCapability(
      { id: "checkpoint.capture", version: "1.0.0", description: "Take a bounded content-addressed snapshot of the session workspace so risky work has a real recovery path.", risk: "workspace_read", sideEffect: true, source: "core" },
      z.object({ label: z.string().min(1).max(200), reason: z.string().min(1).max(2000), actionId: z.string().max(300).optional(), maxFiles: z.number().int().min(1).max(50_000).optional(), maxTotalBytes: z.number().int().min(1024).max(1_073_741_824).optional() }),
      async (input, ctx) => await service.capture(auroraDefined({
        tenantId: ctx.tenantId, workspacePath: ctx.workspacePath, sessionId: ctx.sessionId,
        label: input.label, reason: input.reason, actionId: input.actionId,
        limits: auroraDefined({ maxFiles: input.maxFiles, maxTotalBytes: input.maxTotalBytes }),
      })),
    ),
    defineCapability(
      { id: "checkpoint.diff", version: "1.0.0", description: "Compare the current workspace against a checkpoint without changing anything.", risk: "workspace_read", sideEffect: false, source: "core" },
      z.object({ checkpointId: z.string() }),
      async (input, ctx) => await service.diff(ctx.tenantId, input.checkpointId, ctx.workspacePath),
    ),
    defineCapability(
      { id: "checkpoint.restore", version: "1.0.0", description: "Restore the workspace to a checkpoint. A safety checkpoint is taken first, so the rollback is itself reversible.", risk: "privileged", sideEffect: true, source: "core" },
      z.object({ checkpointId: z.string(), removeAddedFiles: z.boolean().optional(), safetyCheckpoint: z.boolean().optional() }),
      async (input, ctx) => await service.restore(auroraDefined({
        tenantId: ctx.tenantId, workspacePath: ctx.workspacePath, checkpointId: input.checkpointId,
        removeAddedFiles: input.removeAddedFiles, safetyCheckpoint: input.safetyCheckpoint,
      })),
    ),
    defineCapability(
      { id: "checkpoint.list", version: "1.0.0", description: "List workspace checkpoints with their manifests and restore history.", risk: "pure", sideEffect: false, source: "core" },
      z.object({ sessionId: z.string().optional(), limit: z.number().int().min(1).max(1000).optional() }),
      async (input, ctx) => ({ checkpoints: await service.list(ctx.tenantId, auroraDefined(input)) }),
    ),
    defineCapability(
      { id: "checkpoint.usage", version: "1.0.0", description: "Checkpoint storage footprint and deduplication ratio.", risk: "pure", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, ctx) => await service.usage(ctx.tenantId),
    ),
  ];
}

export function auroraMetricsCapabilities(service: AuroraMetricsCollector) {
  return [
    defineCapability(
      { id: "aurora.metrics", version: "1.0.0", description: "Content-free Aurora telemetry across cognition, memory, world, initiative, society, evolution, environment, decisions, plans, constitution and autopilot.", risk: "pure", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, ctx) => await service.snapshot(ctx.tenantId),
    ),
    defineCapability(
      { id: "aurora.alerts", version: "1.0.0", description: "Threshold alerts derived from Aurora telemetry: degraded health, budget exhaustion, miscalibration, verification debt, overconfidence and failing autopilot.", risk: "pure", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, ctx) => ({ alerts: await service.alerts(ctx.tenantId) }),
    ),
  ];
}

export function governanceCapabilities(service: AuroraDataGovernanceService) {
  return [
    defineCapability(
      { id: "aurora.export", version: "1.0.0", description: "Export everything Aurora holds for the tenant, or for one user, with per-section digests.", risk: "pure", sideEffect: false, source: "core" },
      z.object({ userId: z.string().max(200).optional(), includeContent: z.boolean().optional() }),
      async (input, ctx) => await service.export(auroraDefined({ tenantId: ctx.tenantId, ...input })),
    ),
    defineCapability(
      { id: "aurora.purge.user", version: "1.0.0", description: "Purge a user's stored inferences. Defaults to a dry run; audit-grade records are reported as retained rather than silently kept.", risk: "privileged", sideEffect: true, source: "core" },
      z.object({ userId: z.string().min(1).max(200), dryRun: z.boolean().optional() }),
      async (input, ctx) => await service.purgeUser(auroraDefined({ tenantId: ctx.tenantId, ...input })),
    ),
    defineCapability(
      { id: "aurora.selfcheck", version: "1.0.0", description: "Cross-store integrity audit: dangling references, reservation drift, verification debt, ungated production skills, quarantine bypass and constitutional floor damage.", risk: "pure", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, ctx) => await service.selfCheck(ctx.tenantId),
    ),
    defineCapability(
      { id: "aurora.footprint", version: "1.0.0", description: "Retention view of how many records each Aurora store holds.", risk: "pure", sideEffect: false, source: "core" },
      z.object({}),
      async (_input, ctx) => await service.footprint(ctx.tenantId),
    ),
  ];
}
