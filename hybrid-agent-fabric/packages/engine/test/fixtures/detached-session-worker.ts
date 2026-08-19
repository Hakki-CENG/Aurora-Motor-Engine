import { resolve } from "node:path";
import { HybridAgentEngine } from "../../src/engine.js";
import { WorkerProtocolServer } from "../../src/runtime/worker/worker-server.js";
import type { CommandEnvelope } from "../../src/types.js";

const id = process.env.HAF_WORKER_ID!;
const home = process.env.HAF_WORKER_HOME!;
const engine = new HybridAgentEngine({
  homePath: home,
  kernelServerScript: resolve(process.cwd(), "../../python/kernel_server.py"),
  sandboxBackend: "local",
  autoApproveWorkspaceWrites: true,
  allowProcessExecution: true,
  model: { provider: "mock" },
});
try { await engine.session(id); }
catch { await engine.createSession({ sessionId: id, tenantId: "local", name: "root", workspacePath: resolve(home, "workspaces", id) }); }
let closing = false;
const server = new WorkerProtocolServer({
  workerId: id,
  socketPath: process.env.HAF_WORKER_SOCKET!,
  descriptorPath: process.env.HAF_WORKER_DESCRIPTOR!,
  token: process.env.HAF_WORKER_TOKEN!,
  commandHandler: async (method, payload) => {
    const body = payload.length ? JSON.parse(payload.toString()) : {};
    if (method === "state") return await engine.session(body.sessionId ?? id);
    if (method === "list_sessions") return { sessions: await engine.sessions("local") };
    if (method === "dispatch") return await engine.command(body as CommandEnvelope);
    if (method === "spawn_child") return await engine.supervisor.spawnChild({ parentSessionId: id, task: body.task, name: body.name });
    if (method === "shutdown") { closing = true; setTimeout(() => void shutdown(), 20); return { closing }; }
    throw new Error("unknown");
  },
  snapshotProvider: async () => ({ sessions: await engine.sessions("local") }),
});
engine.events.subscribeAll((event) => server.publish("session_event", event));
await server.start();
async function shutdown() { await engine.shutdown(); await server.stop(); process.exit(0); }
process.once("SIGTERM", () => void shutdown());
