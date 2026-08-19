import { describe, expect, it } from "vitest";
import { MemoryEventStore } from "../src/persistence/event-store.js";
import { NatsCommandBus, NatsEventBridge, NatsTransport, type NatsConnectionLike } from "../src/transport/nats/nats-transport.js";
import type { CommandEnvelope, EventEnvelope } from "../src/types.js";

class FakeSubscription implements AsyncIterable<any> {
  queue: any[] = [];
  waiters: Array<(value: IteratorResult<any>) => void> = [];
  active = true;
  push(value: any) { const waiter = this.waiters.shift(); waiter ? waiter({ value, done: false }) : this.queue.push(value); }
  unsubscribe() { this.active = false; for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true }); }
  [Symbol.asyncIterator]() {
    return { next: async (): Promise<IteratorResult<any>> => {
      if (this.queue.length) return { value: this.queue.shift(), done: false };
      if (!this.active) return { value: undefined, done: true };
      return await new Promise((resolve) => this.waiters.push(resolve));
    } };
  }
}

class FakeNats implements NatsConnectionLike {
  published: Array<{ subject: string; data: Uint8Array }> = [];
  subscriptions = new Map<string, Set<FakeSubscription>>();
  publish(subject: string, data = new Uint8Array()) {
    this.published.push({ subject, data });
    for (const sub of this.subscriptions.get(subject) ?? []) sub.push({ data, respond: () => false });
  }
  subscribe(subject: string) {
    const sub = new FakeSubscription();
    const set = this.subscriptions.get(subject) ?? new Set(); set.add(sub); this.subscriptions.set(subject, set);
    return sub;
  }
  async request(subject: string, data = new Uint8Array(), options?: { timeout?: number }): Promise<{ data: Uint8Array }> {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), options?.timeout ?? 1000);
      for (const sub of this.subscriptions.get(subject) ?? []) {
        sub.push({ data, respond: (response: Uint8Array) => { clearTimeout(timer); resolve({ data: response }); return true; } });
      }
    });
  }
  async drain() { for (const set of this.subscriptions.values()) for (const sub of set) sub.unsubscribe(); }
}

const event: EventEnvelope = {
  schemaVersion: 1, eventId: "event", tenantId: "raw-tenant", sessionId: "session", familyId: "family",
  generation: 1, sequence: 1, traceId: "trace", type: "test", timestamp: new Date().toISOString(),
  visibility: "internal", redactionClass: "none", payload: {},
};
const command: CommandEnvelope = {
  protocolVersion: 1, commandId: "command", clientId: "client", tenantId: "tenant", sessionId: "session",
  kind: "session.pause", source: "api", issuedAt: new Date().toISOString(), payload: {},
};

describe("NATS distributed transport", () => {
  it("publishes events on opaque tenant subjects", async () => {
    const connection = new FakeNats();
    const transport = new NatsTransport({ servers: "nats://unused", connection, prefix: "haf" });
    const store = new MemoryEventStore();
    const bridge = new NatsEventBridge(transport, store);
    await bridge.start();
    await store.append(event);
    expect(connection.published).toHaveLength(1);
    expect(connection.published[0]!.subject).toMatch(/^haf\.events\.[a-f0-9]{24}$/);
    expect(connection.published[0]!.subject).not.toContain("raw-tenant");
    expect(JSON.parse(Buffer.from(connection.published[0]!.data).toString()).eventId).toBe("event");
    bridge.stop();
  });

  it("routes typed command request/reply to a worker subject", async () => {
    const connection = new FakeNats();
    const transport = new NatsTransport({ servers: "nats://unused", connection, prefix: "haf" });
    const bus = new NatsCommandBus(transport);
    const stop = await bus.serve("worker-1", async (received) => ({
      commandId: received.commandId, status: "completed", result: { worker: "one" },
    }));
    const result = await bus.request("worker-1", command, 1000);
    expect(result).toEqual({ commandId: "command", status: "completed", result: { worker: "one" } });
    stop(); bus.close();
  });
});
