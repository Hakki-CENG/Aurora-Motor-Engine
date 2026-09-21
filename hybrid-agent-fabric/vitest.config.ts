import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Root vitest configuration.
 *
 * The canonical entrypoint is `npm test`, which runs `vitest run` inside each
 * workspace. This config makes a whole-repo `npx vitest run` from the root
 * behave identically, so an ad-hoc run is a truthful signal rather than a trap.
 *
 * Two things are needed for that:
 *
 * 1. `projects` — each workspace is declared with its own root so module and
 *    config resolution match the per-package invocation.
 *
 * 2. `setupFiles` + `define` — vitest does NOT change `process.cwd()` per
 *    project; workers inherit the launch directory. Since ~62 engine suites
 *    resolve fixtures via `resolve(process.cwd(), "...")` (the Python kernel,
 *    the tsx CLI, the WASI runner build, `test/fixtures/*`), a root-level run
 *    otherwise fails with misleading "exited during startup" errors.
 *    `vitest.setup.cwd.ts` chdirs each worker to its project root.
 *
 * `**\/e2e\/**` is excluded everywhere: those are Playwright specs that import
 * `@playwright/test`, which throws when collected by vitest. Playwright owns
 * them via `apps/canvas-web/playwright.config.ts`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

const sharedExclude = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.{idea,git,cache,output,temp}/**",
  // Playwright end-to-end specs — run with `npm run test:e2e -w @haf/canvas-web`.
  "**/e2e/**",
  // Generated eval artifacts. Task workspaces and graded outputs can contain
  // files literally named `*.test.js`; they are fixtures produced by a run,
  // not suites to execute.
  "**/packages/eval/results/**",
  "**/packages/eval/.workspaces/**",
];

const setupFile = fileURLToPath(new URL("./vitest.setup.cwd.ts", import.meta.url));

const project = (name: string, relativeRoot: string) => {
  const root = fileURLToPath(new URL(relativeRoot, import.meta.url));
  // Strip the trailing slash so `process.cwd()` comparisons are exact.
  const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  return {
    define: { __HAF_PROJECT_ROOT__: JSON.stringify(normalizedRoot) },
    test: {
      name,
      root: normalizedRoot,
      exclude: sharedExclude,
      setupFiles: [setupFile],
    },
  };
};

export default defineConfig({
  root: here,
  test: {
    exclude: sharedExclude,
    projects: [
      project("engine", "./packages/engine/"),
      project("eval", "./packages/eval/"),
      project("control-api", "./apps/control-api/"),
      project("headless-client", "./apps/headless-client/"),
      project("release-tool", "./apps/release-tool/"),
      project("canvas-web", "./apps/canvas-web/"),
      project("desktop", "./apps/desktop/"),
    ],
  },
});
