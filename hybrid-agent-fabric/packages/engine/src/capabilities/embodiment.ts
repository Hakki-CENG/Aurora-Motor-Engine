/**
 * Embodiment Capabilities
 * Bridges FileSystemAgent and ActionFramework to the CapabilityBroker.
 * Enables Aurora to interact with the file system and execute multi-step action plans.
 */

import { z } from "zod";
import { defineCapability } from "./schema.js";
import type { FileSystemAgent } from "../embodiment/filesystem-agent.js";
import type { ActionFramework } from "../embodiment/action-framework.js";

/**
 * Creates file system embodiment capabilities that wrap the FileSystemAgent.
 * These capabilities provide safe, policy-governed access to file operations
 * beyond the basic read/write in the core filesystem capabilities.
 */
export function fileSystemAgentCapabilities(agent: FileSystemAgent) {
  return [
    defineCapability(
      {
        id: "embodiment.fs.search",
        version: "1.0.0",
        description: "Search for text content across files in the workspace using the File System Agent.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({
        query: z.string().min(1).max(500),
        path: z.string().default("."),
        filePattern: z.string().default("*"),
      }),
      async ({ query, path, filePattern }) => {
        const results = await agent.searchContent(query, path, filePattern);
        return { query, results, count: results.length };
      },
    ),

    defineCapability(
      {
        id: "embodiment.fs.find",
        version: "1.0.0",
        description: "Find files by glob pattern using the File System Agent.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({
        pattern: z.string().min(1).max(500),
      }),
      async ({ pattern }) => {
        const results = await agent.findFiles(pattern);
        return { pattern, results, count: results.length };
      },
    ),

    defineCapability(
      {
        id: "embodiment.fs.info",
        version: "1.0.0",
        description: "Get detailed file information using the File System Agent.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({
        path: z.string().min(1),
      }),
      async ({ path }) => {
        const info = await agent.getFileInfo(path);
        return info;
      },
    ),

    defineCapability(
      {
        id: "embodiment.fs.mkdir",
        version: "1.0.0",
        description: "Create a directory (with parents) using the File System Agent.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({
        path: z.string().min(1),
      }),
      async ({ path }) => {
        await agent.createDirectory(path);
        return { created: path };
      },
    ),

    defineCapability(
      {
        id: "embodiment.fs.delete",
        version: "1.0.0",
        description: "Delete a file using the File System Agent.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({
        path: z.string().min(1),
      }),
      async ({ path }) => {
        await agent.deleteFile(path);
        return { deleted: path };
      },
    ),

    defineCapability(
      {
        id: "embodiment.fs.rename",
        version: "1.0.0",
        description: "Rename or move a file using the File System Agent.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({
        oldPath: z.string().min(1),
        newPath: z.string().min(1),
      }),
      async ({ oldPath, newPath }) => {
        await agent.renameFile(oldPath, newPath);
        return { from: oldPath, to: newPath };
      },
    ),

    defineCapability(
      {
        id: "embodiment.fs.copy",
        version: "1.0.0",
        description: "Copy a file using the File System Agent.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({
        source: z.string().min(1),
        destination: z.string().min(1),
      }),
      async ({ source, destination }) => {
        await agent.copyFile(source, destination);
        return { from: source, to: destination };
      },
    ),
  ];
}

/**
 * Creates action framework capabilities that wrap the ActionFramework.
 * These capabilities enable Aurora to plan, execute, and verify multi-step actions.
 */
export function actionFrameworkCapabilities(framework: ActionFramework) {
  return [
    defineCapability(
      {
        id: "embodiment.action.create_goal",
        version: "1.0.0",
        description: "Create a new goal in the action framework.",
        risk: "pure",
        sideEffect: true,
        source: "core",
      },
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(2000),
        priority: z.enum(["P0", "P1", "P2", "P3", "P4"]).default("P2"),
        successCriteria: z.array(z.string()).default([]),
        constraints: z.array(z.string()).default([]),
        deadline: z.string().optional(),
      }),
      async (input, context) => {
        const goalInput: {
          title: string;
          description: string;
          priority: "P0" | "P1" | "P2" | "P3" | "P4";
          successCriteria: string[];
          constraints: string[];
          deadline?: string;
        } = {
          title: input.title,
          description: input.description,
          priority: input.priority,
          successCriteria: input.successCriteria,
          constraints: input.constraints,
        };
        if (input.deadline !== undefined) goalInput.deadline = input.deadline;
        return framework.createGoal({ tenantId: context.tenantId, ...goalInput });
      },
    ),

    defineCapability(
      {
        id: "embodiment.action.accept_goal",
        version: "1.0.0",
        description: "Accept a proposed goal.",
        risk: "pure",
        sideEffect: true,
        source: "core",
      },
      z.object({
        goalId: z.string().min(1),
      }),
      async ({ goalId }) => {
        const goal = await framework.acceptGoal(goalId);
        return goal;
      },
    ),

    defineCapability(
      {
        id: "embodiment.action.create_plan",
        version: "1.0.0",
        description: "Create an execution plan for a goal.",
        risk: "pure",
        sideEffect: true,
        source: "core",
      },
      z.object({
        goalId: z.string().min(1),
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(2000),
        steps: z.array(z.object({
          title: z.string().min(1).max(200),
          description: z.string().min(1).max(500),
          actionType: z.string().min(1).max(100),
          input: z.record(z.unknown()).default({}),
          expectedOutput: z.string().default(""),
          dependsOn: z.array(z.number().int().nonnegative()).default([]),
        })),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
      }),
      async (input, context) => {
        const plan = framework.createPlan({ tenantId: context.tenantId, ...input });
        return plan;
      },
    ),

    defineCapability(
      {
        id: "embodiment.action.approve_plan",
        version: "1.0.0",
        description: "Approve a plan for execution.",
        risk: "pure",
        sideEffect: true,
        source: "core",
      },
      z.object({
        planId: z.string().min(1),
      }),
      async ({ planId }) => {
        const plan = await framework.approvePlan(planId);
        return plan;
      },
    ),

    defineCapability(
      {
        id: "embodiment.action.record_result",
        version: "1.0.0",
        description: "Record the result of a plan step execution.",
        risk: "pure",
        sideEffect: true,
        source: "core",
      },
      z.object({
        planId: z.string().min(1),
        stepId: z.string().min(1),
        success: z.boolean(),
        output: z.unknown().default(null),
        error: z.string().optional(),
        durationMs: z.number().int().nonnegative().default(0),
        tokensUsed: z.number().int().nonnegative().default(0),
        sideEffects: z.array(z.string()).default([]),
      }),
      async ({ planId, stepId, ...rest }) => {
        const result: {
          success: boolean;
          output: unknown;
          error?: string;
          durationMs: number;
          tokensUsed: number;
          sideEffects: string[];
          verificationNeeded: boolean;
          evidence: string[];
        } = {
          success: rest.success,
          output: rest.output,
          durationMs: rest.durationMs,
          tokensUsed: rest.tokensUsed,
          sideEffects: rest.sideEffects,
          verificationNeeded: true,
          evidence: [],
        };
        if (rest.error !== undefined) result.error = rest.error;
        await framework.recordStepResult(planId, stepId, result);
        return { recorded: true, planId, stepId };
      },
    ),

    defineCapability(
      {
        id: "embodiment.action.list_goals",
        version: "1.0.0",
        description: "List all goals in the action framework.",
        risk: "pure",
        sideEffect: false,
        source: "core",
      },
      z.object({}),
      async () => {
        return framework.getGoals();
      },
    ),

    defineCapability(
      {
        id: "embodiment.action.list_plans",
        version: "1.0.0",
        description: "List all plans, optionally filtered by goal.",
        risk: "pure",
        sideEffect: false,
        source: "core",
      },
      z.object({
        goalId: z.string().optional(),
      }),
      async ({ goalId }) => {
        if (goalId) return framework.getPlansForGoal(goalId);
        return framework.getPlans();
      },
    ),

    defineCapability(
      {
        id: "embodiment.action.stats",
        version: "1.0.0",
        description: "Get action framework statistics.",
        risk: "pure",
        sideEffect: false,
        source: "core",
      },
      z.object({}),
      async () => {
        return framework.getStats();
      },
    ),
  ];
}
