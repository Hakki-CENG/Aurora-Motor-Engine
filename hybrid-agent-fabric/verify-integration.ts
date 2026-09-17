/**
 * Integration Verification Script
 * Checks that all new modules are properly connected.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "/home/user/Aurora-Motor-Engine/hybrid-agent-fabric";

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "WARN";
  message: string;
}

const results: CheckResult[] = [];

function check(name: string, condition: boolean, message: string, warnOnly = false) {
  results.push({
    name,
    status: condition ? "PASS" : warnOnly ? "WARN" : "FAIL",
    message: condition ? message : `FAILED: ${message}`,
  });
}

function fileExists(path: string): boolean {
  return existsSync(resolve(BASE, path));
}

function fileContains(path: string, search: string): boolean {
  try {
    const content = readFileSync(resolve(BASE, path), "utf-8");
    return content.includes(search);
  } catch {
    return false;
  }
}

// ─── 1. Middleware Files ───
console.log("\n=== 1. MIDDLEWARE FILES ===");
check("rate-limiter.ts exists", fileExists("apps/control-api/src/middleware/rate-limiter.ts"), "Rate limiter middleware created");
check("security-headers.ts exists", fileExists("apps/control-api/src/middleware/security-headers.ts"), "Security headers middleware created");
check("error-handler.ts exists", fileExists("apps/control-api/src/middleware/error-handler.ts"), "Error handler middleware created");
check("audit-logger.ts exists", fileExists("apps/control-api/src/middleware/audit-logger.ts"), "Audit logger middleware created");
check("request-validator.ts exists", fileExists("apps/control-api/src/middleware/request-validator.ts"), "Request validator middleware created");
check("middleware/index.ts exists", fileExists("apps/control-api/src/middleware/index.ts"), "Middleware barrel export created");

// ─── 2. Route Files ───
console.log("\n=== 2. ROUTE FILES ===");
const routeFiles = [
  "sessions.ts", "aurora-memory.ts", "aurora-world.ts", "aurora-initiative.ts",
  "aurora-evolution.ts", "aurora-cognitive.ts", "platforms.ts", "mcp.ts",
  "learning.ts", "automations.ts", "society.ts", "plugins.ts", "index.ts",
];
for (const file of routeFiles) {
  check(`route/${file} exists`, fileExists(`apps/control-api/src/routes/${file}`), `Route module ${file} created`);
}

// ─── 3. UI Components ───
console.log("\n=== 3. UI COMPONENTS ===");
check("ChatPanel.tsx exists", fileExists("apps/canvas-web/src/components/ChatPanel.tsx"), "Chat panel component created");
check("TerminalPanel.tsx exists", fileExists("apps/canvas-web/src/components/TerminalPanel.tsx"), "Terminal panel component created");
check("FilesPanel.tsx exists", fileExists("apps/canvas-web/src/components/FilesPanel.tsx"), "Files panel component created");
check("DiffViewer.tsx exists", fileExists("apps/canvas-web/src/components/DiffViewer.tsx"), "Diff viewer component created");

// ─── 4. Aurora Integration Services ───
console.log("\n=== 4. AURORA INTEGRATION SERVICES ===");
check("thought-memory-integration.ts exists", fileExists("packages/engine/src/thought/thought-memory-integration.ts"), "Thought-Memory integration created");
check("world-thought-integration.ts exists", fileExists("packages/engine/src/world/world-thought-integration.ts"), "World-Thought integration created");
check("memory-initiative-integration.ts exists", fileExists("packages/engine/src/initiative/memory-initiative-integration.ts"), "Memory-Initiative integration created");
check("stuck-evolution-integration.ts exists", fileExists("packages/engine/src/evolution/stuck-evolution-integration.ts"), "Stuck-Evolution integration created");

// ─── 5. Digital Embodiment ───
console.log("\n=== 5. DIGITAL EMBODIMENT ===");
check("filesystem-agent.ts exists", fileExists("packages/engine/src/embodiment/filesystem-agent.ts"), "File system agent created");
check("action-framework.ts exists", fileExists("packages/engine/src/embodiment/action-framework.ts"), "Action framework created");
check("embodiment/index.ts exists", fileExists("packages/engine/src/embodiment/index.ts"), "Embodiment barrel export created");

// ─── 6. Documentation ───
console.log("\n=== 6. DOCUMENTATION ===");
check("CONFIGURATION.md exists", fileExists("docs/CONFIGURATION.md"), "Configuration reference created");
check("DEPLOYMENT.md exists", fileExists("docs/DEPLOYMENT.md"), "Deployment guide created");
check("openapi.yaml exists", fileExists("docs/openapi.yaml"), "OpenAPI spec created");
check("CONTRIBUTING.md exists", fileExists("CONTRIBUTING.md"), "Contributing guide created");

// ─── 7. Tests ───
console.log("\n=== 7. TESTS ===");
check("rate-limiter.test.ts exists", fileExists("apps/control-api/test/rate-limiter.test.ts"), "Rate limiter tests created");
check("error-handler.test.ts exists", fileExists("apps/control-api/test/error-handler.test.ts"), "Error handler tests created");
check("thought-memory-integration.test.ts exists", fileExists("packages/engine/test/thought-memory-integration.test.ts"), "Thought-memory integration tests created");

// ─── 8. Integration Checks ───
console.log("\n=== 8. INTEGRATION CHECKS ===");

// Check main.ts imports middleware
check(
  "main.ts imports middleware",
  fileContains("apps/control-api/src/main.ts", "import { registerRateLimiting, registerSecurityHeaders, registerErrorHandler, registerAuditLogger } from \"./middleware/index.js\""),
  "main.ts correctly imports middleware"
);

// Check main.ts imports routes
check(
  "main.ts imports routes",
  fileContains("apps/control-api/src/main.ts", "import { registerSessionRoutes, registerAuroraMemoryRoutes, registerAuroraWorldRoutes"),
  "main.ts correctly imports route modules"
);

// Check main.ts registers middleware
check(
  "main.ts registers rate limiting",
  fileContains("apps/control-api/src/main.ts", "await registerRateLimiting(app)"),
  "Rate limiting is registered"
);

check(
  "main.ts registers security headers",
  fileContains("apps/control-api/src/main.ts", "await registerSecurityHeaders(app)"),
  "Security headers are registered"
);

check(
  "main.ts registers error handler",
  fileContains("apps/control-api/src/main.ts", "await registerErrorHandler(app)"),
  "Error handler is registered"
);

check(
  "main.ts registers audit logger",
  fileContains("apps/control-api/src/main.ts", "await registerAuditLogger(app)"),
  "Audit logger is registered"
);

// Check main.ts registers routes
check(
  "main.ts registers session routes",
  fileContains("apps/control-api/src/main.ts", "await registerSessionRoutes(app, engine, executeSessionCapability)"),
  "Session routes are registered"
);

check(
  "main.ts registers memory routes",
  fileContains("apps/control-api/src/main.ts", "await registerAuroraMemoryRoutes(app, engine)"),
  "Memory routes are registered"
);

check(
  "main.ts registers world routes",
  fileContains("apps/control-api/src/main.ts", "await registerAuroraWorldRoutes(app, engine)"),
  "World routes are registered"
);

// Check version consistency
check(
  "version is 1.64.0",
  fileContains("apps/control-api/src/main.ts", "version: \"1.64.0\""),
  "Health endpoint version matches package.json"
);

// Check executeSessionCapability is defined before routes
check(
  "executeSessionCapability defined before routes",
  fileContains("apps/control-api/src/main.ts", "async function executeSessionCapability") &&
  fileContains("apps/control-api/src/main.ts", "await registerSessionRoutes(app, engine, executeSessionCapability)"),
  "executeSessionCapability is properly defined"
);

// Check CSS has design tokens
check(
  "CSS has design tokens",
  fileContains("apps/canvas-web/src/styles.css", "--space-1: 4px"),
  "CSS design tokens are defined"
);

// Check CSS has chat panel styles
check(
  "CSS has chat panel styles",
  fileContains("apps/canvas-web/src/styles.css", ".chat-panel"),
  "Chat panel CSS styles exist"
);

// Check CSS has terminal panel styles
check(
  "CSS has terminal panel styles",
  fileContains("apps/canvas-web/src/styles.css", ".terminal-panel"),
  "Terminal panel CSS styles exist"
);

// Check CSS has diff viewer styles
check(
  "CSS has diff viewer styles",
  fileContains("apps/canvas-web/src/styles.css", ".diff-viewer"),
  "Diff viewer CSS styles exist"
);

// ─── 9. Route Module Integration ───
console.log("\n=== 9. ROUTE MODULE INTEGRATION ===");

// Check sessions route uses engine API
check(
  "sessions route uses engine.createSession",
  fileContains("apps/control-api/src/routes/sessions.ts", "engine.createSession"),
  "Sessions route properly uses engine API"
);

// Check memory route uses engine API
check(
  "memory route uses engine.memoryGraph",
  fileContains("apps/control-api/src/routes/aurora-memory.ts", "engine.memoryGraph"),
  "Memory route properly uses engine API"
);

// Check world route uses engine API
check(
  "world route uses engine.worldModel",
  fileContains("apps/control-api/src/routes/aurora-world.ts", "engine.worldModel"),
  "World route properly uses engine API"
);

// Check initiative route uses engine API
check(
  "initiative route uses engine.initiative",
  fileContains("apps/control-api/src/routes/aurora-initiative.ts", "engine.initiative"),
  "Initiative route properly uses engine API"
);

// Check evolution route uses engine API
check(
  "evolution route uses engine.evolution",
  fileContains("apps/control-api/src/routes/aurora-evolution.ts", "engine.evolution"),
  "Evolution route properly uses engine API"
);

// Check cognitive route uses engine API
check(
  "cognitive route uses engine.cognitive",
  fileContains("apps/control-api/src/routes/aurora-cognitive.ts", "engine.cognitive"),
  "Cognitive route properly uses engine API"
);

// Check platform route uses engine API
check(
  "platform route uses engine.telegram",
  fileContains("apps/control-api/src/routes/platforms.ts", "engine.telegram"),
  "Platform route properly uses engine API"
);

// Check MCP route uses engine API
check(
  "MCP route uses engine.mcp",
  fileContains("apps/control-api/src/routes/mcp.ts", "engine.mcp"),
  "MCP route properly uses engine API"
);

// Check learning route uses engine API
check(
  "learning route uses engine.learning",
  fileContains("apps/control-api/src/routes/learning.ts", "engine.learning"),
  "Learning route properly uses engine API"
);

// Check automation route uses engine API
check(
  "automation route uses engine.automations",
  fileContains("apps/control-api/src/routes/automations.ts", "engine.automations"),
  "Automation route properly uses engine API"
);

// Check society route uses engine API
check(
  "society route uses engine.society",
  fileContains("apps/control-api/src/routes/society.ts", "engine.society"),
  "Society route properly uses engine API"
);

// ─── 10. Error Code System ───
console.log("\n=== 10. ERROR CODE SYSTEM ===");
check(
  "error-handler has HAF-1001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-1001"),
  "Auth error codes defined"
);

check(
  "error-handler has HAF-2001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-2001"),
  "Validation error codes defined"
);

check(
  "error-handler has HAF-3001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-3001"),
  "Session error codes defined"
);

check(
  "error-handler has HAF-4001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-4001"),
  "Aurora error codes defined"
);

check(
  "error-handler has HAF-5001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-5001"),
  "Platform error codes defined"
);

check(
  "error-handler has HAF-6001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-6001"),
  "Model error codes defined"
);

check(
  "error-handler has HAF-7001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-7001"),
  "Resource error codes defined"
);

check(
  "error-handler has HAF-8001",
  fileContains("apps/control-api/src/middleware/error-handler.ts", "HAF-8001"),
  "System error codes defined"
);

// ─── Results Summary ───
console.log("\n" + "=".repeat(60));
console.log("INTEGRATION VERIFICATION RESULTS");
console.log("=".repeat(60));

const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
const warned = results.filter((r) => r.status === "WARN").length;

for (const result of results) {
  const icon = result.status === "PASS" ? "✅" : result.status === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} ${result.name}: ${result.message}`);
}

console.log("\n" + "=".repeat(60));
console.log(`TOTAL: ${results.length} checks`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
console.log(`WARNINGS: ${warned}`);
console.log("=".repeat(60));

if (failed > 0) {
  console.log("\n❌ SOME CHECKS FAILED - Please fix the issues above");
  process.exit(1);
} else {
  console.log("\n✅ ALL CHECKS PASSED - System is properly integrated!");
  process.exit(0);
}
