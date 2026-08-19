import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { atomicWrite, atomicWriteBuffer } from "../util/atomic-file.js";
import { defineCapability } from "./schema.js";

async function confinedPath(workspacePath: string, requestedPath: string, forWrite = false): Promise<string> {
  const root = await realpath(workspacePath);
  const candidate = resolve(root, requestedPath);
  const lexicalRelative = relative(root, candidate);
  if (lexicalRelative.startsWith(`..${sep}`) || lexicalRelative === ".." || lexicalRelative.startsWith(sep)) {
    throw new Error("Path escapes the assigned workspace.");
  }
  if (!forWrite) {
    const actual = await realpath(candidate);
    const actualRelative = relative(root, actual);
    if (actualRelative.startsWith(`..${sep}`) || actualRelative === "..") throw new Error("Symlink escapes the workspace.");
    return actual;
  }
  let parent = dirname(candidate);
  while (parent !== root) {
    try {
      const actualParent = await realpath(parent);
      const parentRelative = relative(root, actualParent);
      if (parentRelative.startsWith(`..${sep}`) || parentRelative === "..") throw new Error("Write path follows a symlink outside workspace.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parent = dirname(parent);
    }
  }
  return candidate;
}

export function filesystemCapabilities() {
  return [
    defineCapability(
      {
        id: "filesystem.read",
        version: "1.0.0",
        description: "Read a UTF-8 text file inside the assigned workspace.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({ path: z.string().min(1), maxChars: z.number().int().positive().max(1_000_000).optional() }),
      async ({ path, maxChars = 200_000 }, context) => {
        const actual = await confinedPath(context.workspacePath, path);
        const content = await readFile(actual, "utf8");
        return { path, content: content.slice(0, maxChars), truncated: content.length > maxChars, chars: content.length };
      },
    ),
    defineCapability(
      {
        id: "filesystem.write",
        version: "1.0.0",
        description: "Atomically write a UTF-8 file inside the assigned workspace.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({ path: z.string().min(1), content: z.string().max(2_000_000) }),
      async ({ path, content }, context) => {
        const actual = await confinedPath(context.workspacePath, path, true);
        await mkdir(dirname(actual), { recursive: true });
        await atomicWrite(actual, content);
        return { path, writtenChars: content.length };
      },
    ),
    defineCapability(
      {
        id: "filesystem.write_binary",
        version: "1.0.0",
        description: "Atomically decode and write a bounded base64 binary file inside the assigned workspace.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({
        path: z.string().min(1),
        base64: z.string().min(1).max(4_194_304),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      }),
      async ({ path, base64, expectedSha256 }, context) => {
        const normalized = base64.replace(/\s+/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) throw new Error("Binary upload base64 is malformed.");
        const bytes = Buffer.from(normalized, "base64");
        if (bytes.length === 0 || bytes.length > 3 * 1024 * 1024) throw new Error("Binary upload exceeds the 3 MiB limit.");
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) throw new Error("Binary upload SHA-256 verification failed.");
        const actual = await confinedPath(context.workspacePath, path, true);
        await mkdir(dirname(actual), { recursive: true });
        await atomicWriteBuffer(actual, bytes);
        return { path, bytes: bytes.length, sha256 };
      },
    ),
    defineCapability(
      {
        id: "filesystem.list",
        version: "1.0.0",
        description: "List files recursively inside the workspace with bounded output.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({ path: z.string().default("."), maxEntries: z.number().int().positive().max(5000).optional() }),
      async ({ path, maxEntries = 500 }, context) => {
        const base = await confinedPath(context.workspacePath, path);
        const entries: Array<{ path: string; type: string; size?: number }> = [];
        async function walk(directory: string): Promise<void> {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entries.length >= maxEntries) return;
            if ([".git", "node_modules", ".venv"].includes(entry.name)) continue;
            const full = resolve(directory, entry.name);
            const rel = relative(context.workspacePath, full);
            if (entry.isSymbolicLink()) {
              entries.push({ path: rel, type: "symlink" });
            } else if (entry.isDirectory()) {
              entries.push({ path: rel, type: "directory" });
              await walk(full);
            } else if (entry.isFile()) {
              entries.push({ path: rel, type: "file", size: (await stat(full)).size });
            }
          }
        }
        await walk(base);
        return { entries, truncated: entries.length >= maxEntries };
      },
    ),
  ];
}
