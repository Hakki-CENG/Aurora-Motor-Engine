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


const SEARCH_SKIP_DIRECTORIES = new Set([".git", "node_modules", ".venv", "dist", "build", "target", ".next", "__pycache__", "coverage", ".turbo", ".cache"]);
const MAX_SEARCH_FILES = 20_000;
const MAX_SEARCHED_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Translate a glob into an anchored regular expression.
 *
 * `**` crosses directory separators, `*` does not, `?` is one non-separator character and
 * `{a,b}` is an alternation. Everything else is escaped, so a pattern is a pattern and never an
 * accidental regex injection from a caller who typed a `(`.
 */
function globToRegExp(pattern: string): RegExp {
  let output = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index++;
        if (pattern[index + 1] === "/") index++;
        output += "(?:.*/)?";
      } else {
        output += "[^/]*";
      }
    } else if (char === "?") output += "[^/]";
    else if (char === "{") output += "(?:";
    else if (char === "}") output += ")";
    else if (char === "," ) output += "|";
    else output += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${output}$`);
}

async function* walkFiles(root: string, base: string): AsyncGenerator<{ absolute: string; relative: string }> {
  const stack: string[] = [base];
  let visited = 0;
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited >= MAX_SEARCH_FILES) return;
      if (entry.name.startsWith(".") && SEARCH_SKIP_DIRECTORIES.has(entry.name)) continue;
      if (SEARCH_SKIP_DIRECTORIES.has(entry.name)) continue;
      const full = resolve(directory, entry.name);
      // Symlinks are listed by `filesystem.list` but never followed by a search: a link into /etc
      // would otherwise turn a workspace grep into a host-wide one.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        visited++;
        yield { absolute: full, relative: relative(root, full) };
      }
    }
  }
}

function looksBinary(sample: Buffer): boolean {
  const limit = Math.min(sample.length, 4096);
  for (let index = 0; index < limit; index++) if (sample[index] === 0) return true;
  return false;
}

interface PatchHunk { path: string; oldStart: number; oldLines: string[]; newLines: string[] }

/**
 * Parse a unified diff into per-file hunks.
 *
 * Only what a coding agent actually needs is accepted: `---`/`+++` headers, `@@` hunk headers, and
 * context/add/remove lines. Anything else is refused rather than guessed at, because a patch applied
 * from a half-understood diff is a silent corruption, not an error.
 */
function parseUnifiedDiff(diff: string): Map<string, PatchHunk[]> {
  const files = new Map<string, PatchHunk[]>();
  const lines = diff.split(/\r?\n/);
  let path: string | undefined;
  let hunk: PatchHunk | undefined;
  const flush = () => {
    if (!hunk || !path) return;
    const list = files.get(path) ?? [];
    list.push(hunk);
    files.set(path, list);
    hunk = undefined;
  };
  for (const line of lines) {
    if (line.startsWith("--- ")) { flush(); continue; }
    if (line.startsWith("+++ ")) {
      flush();
      const raw = line.slice(4).trim().split("\t")[0]!;
      path = raw.replace(/^[ab]\//, "");
      if (path === "/dev/null") throw new Error("Deleting files through a patch is not supported; use an explicit removal.");
      continue;
    }
    if (line.startsWith("@@")) {
      flush();
      if (!path) throw new Error("Patch hunk appeared before any file header.");
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) throw new Error(`Unparseable hunk header: ${line.slice(0, 120)}`);
      hunk = { path, oldStart: Number(match[1]), oldLines: [], newLines: [] };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) hunk.newLines.push(line.slice(1));
    else if (line.startsWith("-")) hunk.oldLines.push(line.slice(1));
    else if (line.startsWith(" ")) { hunk.oldLines.push(line.slice(1)); hunk.newLines.push(line.slice(1)); }
    else if (line.startsWith("\\")) continue;
    else if (line.trim() === "") { hunk.oldLines.push(""); hunk.newLines.push(""); }
    else throw new Error(`Unexpected patch line: ${line.slice(0, 120)}`);
  }
  flush();
  if (files.size === 0) throw new Error("The patch contained no file hunks.");
  return files;
}

/** Apply hunks to one file's text. Context must match exactly; a mismatch refuses the whole patch. */
function applyHunks(original: string, hunks: PatchHunk[]): string {
  const lines = original.split("\n");
  // Applied bottom-up so earlier hunk offsets stay valid without bookkeeping.
  for (const hunk of [...hunks].sort((a, b) => b.oldStart - a.oldStart)) {
    const start = hunk.oldStart - 1;
    const actual = lines.slice(start, start + hunk.oldLines.length);
    if (actual.join("\n") !== hunk.oldLines.join("\n")) {
      throw new Error(`Patch context does not match at ${hunk.path}:${hunk.oldStart}; the file changed since the diff was produced.`);
    }
    lines.splice(start, hunk.oldLines.length, ...hunk.newLines);
  }
  return lines.join("\n");
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
    defineCapability(
      {
        id: "filesystem.glob",
        version: "1.0.0",
        description: "Find files by glob pattern (for example src/**/*.ts) inside the workspace, newest first.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({
        pattern: z.string().min(1).max(500),
        path: z.string().max(1000).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
      async ({ pattern, path, limit = 200 }, context) => {
        const root = await realpath(context.workspacePath);
        const base = await confinedPath(context.workspacePath, path ?? ".");
        const matcher = globToRegExp(pattern);
        const matches: Array<{ path: string; size: number; modifiedAt: string }> = [];
        let scanned = 0;
        for await (const file of walkFiles(root, base)) {
          scanned++;
          // The pattern is relative to the directory that was searched, which is what a caller who
          // passed `path: "src"` and `*.md` means; the reported path stays workspace-relative.
          const candidate = relative(base, file.absolute);
          if (!matcher.test(candidate) && !matcher.test(file.relative)) continue;
          const info = await stat(file.absolute).catch(() => undefined);
          if (!info) continue;
          matches.push({ path: file.relative, size: info.size, modifiedAt: new Date(info.mtimeMs).toISOString() });
        }
        // Newest first: when an agent asks "which files match", the ones just touched are the answer
        // it usually wants, and a stable order beats filesystem order.
        matches.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
        return { pattern, scannedFiles: scanned, matches: matches.slice(0, limit), truncated: matches.length > limit };
      },
    ),
    defineCapability(
      {
        id: "filesystem.grep",
        version: "1.0.0",
        description: "Search file contents by regular expression inside the workspace, returning matching lines with their line numbers.",
        risk: "workspace_read",
        sideEffect: false,
        source: "core",
      },
      z.object({
        pattern: z.string().min(1).max(1000),
        path: z.string().max(1000).optional(),
        include: z.string().max(500).optional(),
        ignoreCase: z.boolean().optional(),
        maxMatches: z.number().int().min(1).max(2000).optional(),
        contextLines: z.number().int().min(0).max(5).optional(),
      }),
      async ({ pattern, path, include, ignoreCase, maxMatches = 200, contextLines = 0 }, context) => {
        const root = await realpath(context.workspacePath);
        const base = await confinedPath(context.workspacePath, path ?? ".");
        let expression: RegExp;
        try {
          expression = new RegExp(pattern, ignoreCase ? "i" : "");
        } catch (error) {
          throw new Error(`Invalid search pattern: ${(error as Error).message}`);
        }
        const includeMatcher = include ? globToRegExp(include.includes("/") ? include : `**/${include}`) : undefined;
        const matches: Array<{ path: string; line: number; text: string; before?: string[]; after?: string[] }> = [];
        let scanned = 0;
        let skippedBinary = 0;
        let truncated = false;
        for await (const file of walkFiles(root, base)) {
          if (matches.length >= maxMatches) { truncated = true; break; }
          if (includeMatcher && !includeMatcher.test(relative(base, file.absolute)) && !includeMatcher.test(file.relative)) continue;
          const info = await stat(file.absolute).catch(() => undefined);
          if (!info || info.size > MAX_SEARCHED_FILE_BYTES) continue;
          const buffer = await readFile(file.absolute).catch(() => undefined);
          if (!buffer) continue;
          // A grep that dumps a binary blob into a transcript is worse than one that says it skipped it.
          if (looksBinary(buffer)) { skippedBinary++; continue; }
          scanned++;
          const lines = buffer.toString("utf8").split("\n");
          for (let index = 0; index < lines.length; index++) {
            if (matches.length >= maxMatches) { truncated = true; break; }
            if (!expression.test(lines[index]!)) continue;
            matches.push({
              path: file.relative,
              line: index + 1,
              text: lines[index]!.slice(0, 2000),
              ...(contextLines > 0 ? { before: lines.slice(Math.max(0, index - contextLines), index).map((item) => item.slice(0, 2000)) } : {}),
              ...(contextLines > 0 ? { after: lines.slice(index + 1, index + 1 + contextLines).map((item) => item.slice(0, 2000)) } : {}),
            });
          }
        }
        return { pattern, searchedFiles: scanned, skippedBinaryFiles: skippedBinary, matches, truncated };
      },
    ),
    defineCapability(
      {
        id: "filesystem.patch",
        version: "1.0.0",
        description: "Apply a unified diff to files in the workspace, all or nothing. Context must match exactly; dryRun reports what would change.",
        risk: "workspace_write",
        sideEffect: true,
        source: "core",
      },
      z.object({ diff: z.string().min(1).max(2_000_000), dryRun: z.boolean().optional() }),
      async ({ diff, dryRun }, context) => {
        const files = parseUnifiedDiff(diff);
        const planned: Array<{ path: string; hunks: number; before: number; after: number; created: boolean }> = [];
        const writes: Array<{ absolute: string; content: string }> = [];
        for (const [path, hunks] of files) {
          const target = await confinedPath(context.workspacePath, path, true);
          const original = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          });
          const created = original === undefined;
          // A patch against a file that does not exist may only add lines: anything else is claiming
          // context that was never there.
          if (created && hunks.some((hunk) => hunk.oldLines.length > 0)) {
            throw new Error(`Patch expects existing content in ${path}, but the file does not exist.`);
          }
          const next = created ? hunks.flatMap((hunk) => hunk.newLines).join("\n") : applyHunks(original!, hunks);
          planned.push({
            path,
            hunks: hunks.length,
            before: created ? 0 : original!.split("\n").length,
            after: next.split("\n").length,
            created,
          });
          writes.push({ absolute: target, content: next });
        }
        // Every file is parsed and matched before anything is written, so a patch that fails halfway
        // through leaves the workspace exactly as it was.
        if (!dryRun) {
          for (const write of writes) {
            await mkdir(dirname(write.absolute), { recursive: true });
            await atomicWrite(write.absolute, write.content);
          }
        }
        return { applied: !dryRun, files: planned };
      },
    ),
  ];
}
