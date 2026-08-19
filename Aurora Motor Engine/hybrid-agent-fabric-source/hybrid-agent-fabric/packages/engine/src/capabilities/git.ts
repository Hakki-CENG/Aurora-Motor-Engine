import { z } from "zod";
import type { SandboxFactory, SandboxExecResult } from "../sandbox/sandbox.js";
import { defineCapability } from "./schema.js";

function quote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function branchName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name) || name.includes("..") || name.includes("//") || name.endsWith(".") || name.endsWith("/") || name.includes("@{")) {
    throw new Error("Git branch name is invalid.");
  }
  return name;
}

async function gitRun(
  factory: SandboxFactory,
  workspacePath: string,
  command: string,
  signal?: AbortSignal,
  maxOutputChars = 500_000,
): Promise<SandboxExecResult> {
  const sandbox = await factory(workspacePath);
  try {
    const result = await sandbox.exec({ command, timeoutMs: 120_000, maxOutputChars, ...(signal ? { signal } : {}) });
    if (result.exitCode !== 0) throw new Error(`Git command failed with exit ${result.exitCode}: ${result.stdout.slice(0, 4000)}`);
    return result;
  } finally {
    await sandbox.destroy();
  }
}

export function gitCapabilities(factory: SandboxFactory) {
  return [
    defineCapability(
      {
        id: "git.status",
        version: "1.0.0",
        description: "Read bounded porcelain-v2 repository status and current branch from the session sandbox.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({}),
      async (_input, context) => {
        const result = await gitRun(factory, context.workspacePath, "git status --porcelain=v2 --branch", context.signal);
        return { output: result.stdout, truncated: result.truncated, durationMs: result.durationMs };
      },
    ),
    defineCapability(
      {
        id: "git.diff",
        version: "1.0.0",
        description: "Read a bounded Git diff, optionally including staged changes or one confined pathspec.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({ staged: z.boolean().default(false), path: z.string().min(1).max(1000).optional() }),
      async ({ staged, path }, context) => {
        const command = `git diff --no-ext-diff ${staged ? "--cached " : ""}--${path ? ` ${quote(path)}` : ""}`;
        const result = await gitRun(factory, context.workspacePath, command, context.signal);
        return { output: result.stdout, staged, path: path ?? null, truncated: result.truncated, durationMs: result.durationMs };
      },
    ),
    defineCapability(
      {
        id: "git.branch.list",
        version: "1.0.0",
        description: "List local Git branches and the current branch without contacting a remote.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({}),
      async (_input, context) => {
        const result = await gitRun(factory, context.workspacePath, "git branch --format='%(if)%(HEAD)%(then)*%(else) %(end)%(refname:short)'", context.signal, 100_000);
        const branches = result.stdout.split("\n").filter(Boolean).map((line) => ({ current: line.startsWith("*"), name: line.slice(1) }));
        return { branches };
      },
    ),
    defineCapability(
      {
        id: "git.branch.create",
        version: "1.0.0",
        description: "Create and switch to a validated local Git branch inside the session sandbox.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({ name: z.string().min(1).max(200), startPoint: z.string().min(1).max(200).optional() }),
      async ({ name, startPoint }, context) => {
        const branch = branchName(name);
        const start = startPoint ? branchName(startPoint) : undefined;
        const result = await gitRun(factory, context.workspacePath, `git switch -c ${quote(branch)}${start ? ` ${quote(start)}` : ""}`, context.signal);
        return { branch, output: result.stdout };
      },
    ),
    defineCapability(
      {
        id: "git.branch.switch",
        version: "1.0.0",
        description: "Switch to a validated existing local Git branch inside the session sandbox.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({ name: z.string().min(1).max(200) }),
      async ({ name }, context) => {
        const branch = branchName(name);
        const result = await gitRun(factory, context.workspacePath, `git switch -- ${quote(branch)}`, context.signal);
        return { branch, output: result.stdout };
      },
    ),
    defineCapability(
      {
        id: "git.commit",
        version: "1.0.0",
        description: "Stage explicit pathspecs and create a local commit with hooks disabled. Never pushes to a remote.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({
        message: z.string().min(1).max(10_000),
        paths: z.array(z.string().min(1).max(1000)).min(1).max(200),
        authorName: z.string().min(1).max(200).optional(),
        authorEmail: z.string().email().max(320).optional(),
      }),
      async ({ message, paths, authorName, authorEmail }, context) => {
        const pathArgs = paths.map(quote).join(" ");
        await gitRun(factory, context.workspacePath, `git add -- ${pathArgs}`, context.signal);
        const identity = `${authorName ? `-c user.name=${quote(authorName)} ` : ""}${authorEmail ? `-c user.email=${quote(authorEmail)} ` : ""}`;
        const result = await gitRun(factory, context.workspacePath, `git ${identity}commit --no-verify -m ${quote(message)}`, context.signal);
        const head = await gitRun(factory, context.workspacePath, "git rev-parse HEAD", context.signal, 1000);
        return { commit: head.stdout.trim(), output: result.stdout };
      },
    ),
  ];
}
