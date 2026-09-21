/**
 * Regenerates the runtime observations in `runtime-observation.ts`.
 *
 * A hand-maintained list of "what actually runs" decays exactly like the
 * hand-maintained boolean it replaced, so the measurement has to be a command
 * rather than a memory. Run it after wiring anything new:
 *
 *   npm run observe:runtime -w @haf/engine
 *
 * ## How it measures
 *
 * Two runs under `NODE_V8_COVERAGE`, in separate processes:
 *
 *   1. `initialize()` only.
 *   2. `initialize()` plus one real `engine.execute()` goal.
 *
 * The difference is what the task itself exercised. Without subtracting the
 * first run, every service constructed at startup would look busy — which is
 * how 30 of 30 modules came to be marked `wiredToEngine: true`.
 *
 * Constructors, field initialisers and `getX`/`isX`/`getStats` accessors are
 * excluded: building a service and asking it for its own counters is not the
 * service doing work.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MODULE_MATURITY } from "./maturity.js";

const GOAL = "Create a file called hello.txt containing the word hello";

/** Not real work: construction, field init, and reading a module's own state. */
const NOT_WORK =
  /^<|^__name$|^constructor$|^get[A-Z]|^list[A-Z]|^is[A-Z]|^has[A-Z]|Stats$|^[A-Z][A-Za-z0-9_]*(\.|$)/;

function runnerSource(withTask: boolean): string {
  return `
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HybridAgentEngine } from "../src/engine.js";

const engine = new HybridAgentEngine({
  homePath: mkdtempSync(join(tmpdir(), "observe-")),
  kernelServerScript: resolve(process.cwd(), "../../python/kernel_server.py"),
  sandboxBackend: "local",
  model: { provider: "mock" },
});
await engine.initialize();
${
  withTask
    ? `await engine.execute({
  tenantId: "local", sessionId: "observe", familyId: "observe",
  goal: ${JSON.stringify(GOAL)},
}).catch(() => undefined);`
    : ""
}
await engine.shutdown();
`;
}

/** Module path -> method names that ran, from one coverage directory. */
function readCoverage(directory: string): Map<string, Set<string>> {
  const calls = new Map<string, Set<string>>();
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".json")) continue;
    const parsed = JSON.parse(readFileSync(join(directory, file), "utf8")) as {
      result?: Array<{
        url?: string;
        functions?: Array<{ functionName?: string; ranges?: Array<{ count?: number }> }>;
      }>;
    };
    for (const script of parsed.result ?? []) {
      const url = script.url ?? "";
      if (!url.includes("/src/") || url.includes("/node_modules/")) continue;
      const modulePath = url.split("/src/")[1]!.replace(/\.[cm]?[jt]s$/, "");
      for (const fn of script.functions ?? []) {
        const name = fn.functionName ?? "";
        if (!name || NOT_WORK.test(name)) continue;
        if (!(fn.ranges ?? []).some((range) => (range.count ?? 0) > 0)) continue;
        let bucket = calls.get(modulePath);
        if (!bucket) calls.set(modulePath, (bucket = new Set()));
        bucket.add(name);
      }
    }
  }
  return calls;
}

/** A registry entry may be a file or a directory of files. */
function methodsFor(calls: Map<string, Set<string>>, module: string): Set<string> {
  const found = new Set(calls.get(module) ?? []);
  for (const [path, names] of calls) {
    if (path.startsWith(`${module}/`)) for (const name of names) found.add(name);
  }
  return found;
}

function measure(withTask: boolean): Map<string, Set<string>> {
  // The runner must live inside the package: it imports "../src/engine.js",
  // and a script in /tmp cannot resolve that or the workspace's dependencies.
  const probeDirectory = mkdtempSync(join(resolve("."), ".observe-"));
  const script = join(probeDirectory, "run.mts");
  const coverage = mkdtempSync(join(tmpdir(), "observe-cov-"));
  writeFileSync(script, runnerSource(withTask));
  try {
    execFileSync(resolve("../../node_modules/.bin/tsx"), [script], {
      env: { ...process.env, NODE_V8_COVERAGE: coverage },
      stdio: "ignore",
      timeout: 300_000,
    });
    return readCoverage(coverage);
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
    rmSync(coverage, { recursive: true, force: true });
  }
}

function main(): void {
  process.stdout.write("Measuring startup only...\n");
  const startup = measure(false);
  process.stdout.write("Measuring startup + one real task...\n");
  const withTask = measure(true);

  const rows = MODULE_MATURITY.map((entry) => {
    const during = [...methodsFor(withTask, entry.module)].filter(
      (name) => !methodsFor(startup, entry.module).has(name),
    );
    const loaded =
      methodsFor(withTask, entry.module).size > 0 || withTask.has(entry.module);
    const depth = during.length > 0 ? "exercised" : loaded ? "constructed" : "constructed";
    return { module: entry.module, depth, methods: during.sort() };
  });

  const exercised = rows.filter((row) => row.depth === "exercised");
  process.stdout.write(
    `\n${exercised.length}/${rows.length} modules did work during the task; ` +
      `${rows.length - exercised.length} were only constructed at startup.\n\n`,
  );
  for (const row of rows) {
    const detail = row.methods.length > 0 ? row.methods.slice(0, 4).join(", ") : "—";
    process.stdout.write(`  ${row.depth === "exercised" ? "✓" : " "} ${row.module.padEnd(40)} ${detail}\n`);
  }
  process.stdout.write(
    "\nUpdate RUNTIME_OBSERVATIONS in src/experimental/runtime-observation.ts if this differs.\n",
  );
}

main();
