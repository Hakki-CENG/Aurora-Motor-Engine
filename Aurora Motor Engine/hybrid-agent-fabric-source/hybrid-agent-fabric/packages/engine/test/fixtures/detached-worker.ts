import { WorkerProtocolServer } from "../../src/runtime/worker/worker-server.js";

const workerId = process.env.HAF_WORKER_ID!;
let value = 0;
const server = new WorkerProtocolServer({
  workerId,
  socketPath: process.env.HAF_WORKER_SOCKET!,
  descriptorPath: process.env.HAF_WORKER_DESCRIPTOR!,
  token: process.env.HAF_WORKER_TOKEN!,
  commandHandler: async (method, payload) => {
    if (method === "increment") value += JSON.parse(payload.toString()).by;
    if (method === "shutdown") setTimeout(() => void server.stop().then(() => process.exit(0)), 20);
    return { value, pid: process.pid };
  },
  snapshotProvider: async () => ({ value, pid: process.pid }),
});
await server.start();
setInterval(() => {}, 60_000).unref();
