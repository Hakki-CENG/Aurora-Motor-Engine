/**
 * Version Source of Truth
 * Always reads from package.json — never hardcode version strings.
 */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// Resolve package.json robustly — works with npx tsx, compiled dist, and different CWDs
let version = "1.65.0"; // fallback
let name = "@haf/engine";

try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Try ../../package.json first (relative to src/ or dist/)
  const pkgPath = resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string; version: string };
  version = pkg.version;
  name = pkg.name;
} catch {
  // Fallback: try root package.json
  try {
    const rootPkgPath = resolve(process.cwd(), "package.json");
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8")) as { name: string; version: string };
    version = rootPkg.version;
    name = rootPkg.name;
  } catch {
    // Use defaults
  }
}

/** Engine version — single source of truth from root package.json */
export const ENGINE_VERSION: string = version;

/** Engine name */
export const ENGINE_NAME: string = name;

/** Health/status response shape */
export function getVersionInfo() {
  return {
    name: ENGINE_NAME,
    version: ENGINE_VERSION,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: Math.floor(process.uptime()),
  };
}
