import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
send({ type: "ready", pid: process.pid, protocolVersion: 2 });

while (true) {
  const item = await lines.next();
  if (item.done) break;
  const frame = JSON.parse(item.value);
  if (frame.type === "restore" || frame.type === "snapshot") {
    send({ type: "result", id: frame.id, ok: true, result: {} });
    continue;
  }
  if (frame.type === "shutdown") {
    send({ type: "result", id: frame.id, ok: true, result: "bye" });
    break;
  }
  if (frame.type !== "execute") continue;
  if (frame.code === "hang") {
    await new Promise(() => {});
  }
  const requestId = "host-request-1";
  const hostRequest = {
    type: "host_request",
    requestId,
    executionId: frame.executionId,
    kernelGeneration: frame.kernelGeneration,
    hostToken: frame.code === "stale" ? "wrong-token" : frame.hostToken,
    capability: "test.capability",
    arguments: { value: 1 },
  };
  send(hostRequest);
  const first = JSON.parse((await lines.next()).value);
  if (frame.code === "duplicate") {
    send(hostRequest);
    const second = JSON.parse((await lines.next()).value);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("duplicate response was not replayed");
  }
  send({
    type: "result",
    id: frame.id,
    executionId: frame.executionId,
    ok: true,
    stdout: "",
    stderr: "",
    result: JSON.stringify(first),
    resultType: "str",
  });
}
