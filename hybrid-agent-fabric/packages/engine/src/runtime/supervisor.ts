import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CapabilityBroker } from "../capabilities/capability-broker.js";
import type { ContextManager } from "../context/context-manager.js";
import type { ModelProvider } from "../types.js";
import type {
  AgentInboxMessage,
  AgentMessageDeliveryMode,
  AgentMessageReceipt,
  AgentMessageRelationship,
  CommandEnvelope,
  CommandResult,
  JsonValue,
  SessionAgentProfile,
  SessionSnapshot,
} from "../types.js";
import type { CommandJournalLike } from "../persistence/command-journal.js";
import type { EventStore } from "../persistence/event-store.js";
import type { SnapshotStore } from "../persistence/snapshot-store.js";
import { atomicWrite } from "../util/atomic-file.js";
import { SessionLeaseManager, type SessionLeaseManagerLike } from "../persistence/session-lease.js";
import { createInitialSnapshot, SessionActor, type SessionDispatchHooks } from "./session-actor.js";
import { FileAgentInboxStore, newAgentInboxMessage, type AgentInboxStore } from "./agent-inbox.js";

const execFileAsync = promisify(execFile);

interface SessionCatalogRecord {
  sessionId: string;
  tenantId: string;
  familyId: string;
  parentSessionId?: string;
  forkedFrom?: { sessionId: string; messageId?: string };
  name: string;
  workspacePath: string;
  createdAt: string;
}

export interface CreateSessionInput {
  sessionId?: string;
  tenantId: string;
  name?: string;
  workspacePath?: string;
  familyId?: string;
  parentSessionId?: string;
  forkedFrom?: { sessionId: string; messageId?: string };
  initialMessages?: SessionSnapshot["messages"];
  agentProfile?: SessionAgentProfile;
  skipParentLink?: boolean;
}

export interface AgentFamilyRosterEntry {
  sessionId: string;
  name: string;
  relationship: AgentMessageRelationship;
  status: SessionSnapshot["status"];
  generation: number;
}

export interface SupervisorOptions {
  dataRoot: string;
  workspaceRoot: string;
  eventStore: EventStore;
  snapshotStore: SnapshotStore;
  commandJournal: CommandJournalLike;
  leaseManager?: SessionLeaseManagerLike;
  agentInbox?: AgentInboxStore;
  agentMessageMaxChars?: number;
  agentMessageMaxPending?: number;
  agentMessageRateCapacity?: number;
  agentMessageRateRefillMs?: number;
  model: ModelProvider;
  capabilities: CapabilityBroker;
  context: ContextManager;
  modelName?: string;
  modelFallbacks?: string[];
  onSessionClose?: (sessionId: string) => Promise<void>;
}

export class Supervisor {
  private readonly actors = new Map<string, SessionActor>();
  private catalog: SessionCatalogRecord[] = [];
  private loaded = false;
  private capabilityUnsubscribe: (() => void) | undefined;
  private inboxUnsubscribe: (() => void) | undefined;
  private readonly leases: SessionLeaseManagerLike;
  private readonly agentInbox: AgentInboxStore;
  private readonly inboxOwnerId = randomUUID();
  private readonly inboxDrains = new Set<string>();
  private readonly messageRate = new Map<string, { tokens: number; updatedAt: number }>();
  private readonly deliveryWaiters = new Map<string, { resolve: (message: AgentInboxMessage) => void; reject: (error: Error) => void }>();

  constructor(private readonly options: SupervisorOptions) {
    this.leases = options.leaseManager ?? new SessionLeaseManager(options.dataRoot);
    this.agentInbox = options.agentInbox ?? new FileAgentInboxStore(options.dataRoot);
    this.capabilityUnsubscribe = options.capabilities.subscribe(async (event) => {
      await this.actors.get(event.context.sessionId)?.recordCapabilityLifecycle(event);
    });
    this.inboxUnsubscribe = this.agentInbox.subscribe((targetSessionId) => {
      queueMicrotask(() => void this.drainAgentInbox(targetSessionId));
    });
  }

  private get catalogPath(): string {
    return join(this.options.dataRoot, "catalog", "sessions.json");
  }

  private async loadCatalog(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.catalogPath, "utf8")) as unknown;
      this.catalog = Array.isArray(parsed) ? (parsed as SessionCatalogRecord[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  private async saveCatalog(): Promise<void> {
    await atomicWrite(this.catalogPath, `${JSON.stringify(this.catalog, null, 2)}\n`);
  }

  async createSession(input: CreateSessionInput): Promise<SessionSnapshot> {
    await this.loadCatalog();
    const sessionId = input.sessionId ?? randomUUID();
    if (this.catalog.some((item) => item.sessionId === sessionId)) throw new Error(`Session ${sessionId} already exists.`);
    const workspacePath = input.workspacePath ?? join(this.options.workspaceRoot, sessionId);
    const name = input.name?.trim() || `agent-${sessionId.slice(0, 8)}`;
    if (input.parentSessionId && this.catalog.some((item) =>
      item.tenantId === input.tenantId && item.parentSessionId === input.parentSessionId && item.name === name)) {
      throw new Error(`Agent name ${JSON.stringify(name)} is already used by a sibling under this parent.`);
    }
    await mkdir(workspacePath, { recursive: true });
    const record: SessionCatalogRecord = {
      sessionId,
      tenantId: input.tenantId,
      familyId: input.familyId ?? sessionId,
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.forkedFrom ? { forkedFrom: input.forkedFrom } : {}),
      name,
      workspacePath,
      createdAt: new Date().toISOString(),
    };
    this.catalog.push(record);
    await this.saveCatalog();
    const snapshot = createInitialSnapshot({
      ...record,
      ...(input.initialMessages ? { initialMessages: input.initialMessages } : {}),
      ...(input.agentProfile ? { agentProfile: input.agentProfile } : {}),
      ...(this.options.modelFallbacks?.length ? { modelFallbacks: this.options.modelFallbacks } : {}),
    });
    await this.leases.acquire(sessionId);
    const actor = await this.buildActor(snapshot, false);
    this.actors.set(sessionId, actor);
    await actor.initialize(false);
    if (input.parentSessionId && !input.skipParentLink) await this.getActor(input.parentSessionId).then((parent) => parent.linkChild(sessionId));
    return actor.state;
  }

  async spawnChild(input: {
    parentSessionId: string;
    name?: string;
    task: string;
    source?: CommandEnvelope["source"];
    insideParentTurn?: boolean;
    agentProfile?: SessionAgentProfile;
  }): Promise<SessionSnapshot> {
    const parent = await this.getActor(input.parentSessionId);
    const childId = randomUUID();
    const childWorkspace = join(this.options.workspaceRoot, childId);
    await mkdir(childWorkspace, { recursive: true });
    let isolation = "empty";
    try {
      await execFileAsync("git", ["-C", parent.state.workspacePath, "rev-parse", "--verify", "HEAD"], { timeout: 5000 });
      await execFileAsync("git", ["-C", parent.state.workspacePath, "worktree", "add", "--detach", childWorkspace, "HEAD"], { timeout: 30_000 });
      isolation = "git-worktree";
    } catch {
      try {
        await cp(parent.state.workspacePath, childWorkspace, {
          recursive: true,
          force: false,
          filter: (source) => !source.split(/[\\/]/).includes(".git"),
        });
        isolation = "copy";
      } catch {
        // Empty workspace remains a safe isolation fallback.
      }
    }
    const child = await this.createSession({
      tenantId: parent.state.tenantId,
      name: input.name ?? `child-${childId.slice(0, 8)}`,
      workspacePath: childWorkspace,
      familyId: parent.state.familyId,
      parentSessionId: parent.state.sessionId,
      ...((input.agentProfile ?? parent.state.agentProfile) ? { agentProfile: input.agentProfile ?? parent.state.agentProfile } : {}),
      ...(input.insideParentTurn ? { skipParentLink: true } : {}),
    });
    if (input.insideParentTurn) await parent.linkChildFromCapability(child.sessionId);
    queueMicrotask(() => {
      void this.dispatch({
        protocolVersion: 1,
        commandId: randomUUID(),
        clientId: `parent:${parent.state.sessionId}`,
        tenantId: parent.state.tenantId,
        sessionId: child.sessionId,
        kind: "session.prompt",
        source: input.source ?? "agent",
        issuedAt: new Date().toISOString(),
        payload: { text: input.task, isolation },
      });
    });
    return child;
  }

  async forkSession(input: {
    sourceSessionId: string;
    messageId?: string;
    name?: string;
    includeAbandonedBranchSummary?: boolean;
  }): Promise<SessionSnapshot> {
    const sourceActor = await this.getActor(input.sourceSessionId);
    const source = sourceActor.state;
    let cutIndex = source.messages.length - 1;
    if (input.messageId) {
      cutIndex = source.messages.findIndex((message) => message.id === input.messageId);
      if (cutIndex < 0) throw new Error(`Message ${input.messageId} does not exist in session ${source.sessionId}.`);
    }
    const selected = structuredClone(source.messages.slice(0, cutIndex + 1));
    const abandoned = source.messages.slice(cutIndex + 1);
    if (input.includeAbandonedBranchSummary && abandoned.length > 0) {
      const lines = abandoned
        .filter((message) => message.role === "user" || message.role === "assistant")
        .slice(0, 30)
        .map((message) => {
          const text = message.content
            .filter((part) => part.type === "text")
            .map((part) => part.type === "text" ? part.text : "")
            .join(" ");
          return `- ${message.role}: ${text.slice(0, 400)}`;
        });
      selected.push({
        id: randomUUID(),
        role: "system",
        timestamp: new Date().toISOString(),
        content: [{
          type: "text",
          text: `<ABANDONED_BRANCH_SUMMARY source_session="${source.sessionId}">\n${lines.join("\n")}\n</ABANDONED_BRANCH_SUMMARY>`,
        }],
      });
    }

    const workspaceKey = randomUUID();
    const workspacePath = join(this.options.workspaceRoot, workspaceKey);
    try {
      await execFileAsync("git", ["-C", source.workspacePath, "rev-parse", "--verify", "HEAD"], { timeout: 5000 });
      await execFileAsync("git", ["-C", source.workspacePath, "worktree", "add", "--detach", workspacePath, "HEAD"], { timeout: 30_000 });
    } catch {
      await mkdir(workspacePath, { recursive: true });
      try {
        await cp(source.workspacePath, workspacePath, {
          recursive: true,
          force: false,
          filter: (path) => !path.split(/[\\/]/).includes(".git"),
        });
      } catch {
        // An empty isolated workspace is preferable to silently sharing files.
      }
    }

    const forked = await this.createSession({
      tenantId: source.tenantId,
      name: input.name ?? `${source.name}-fork`,
      workspacePath,
      forkedFrom: {
        sessionId: source.sessionId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
      },
      initialMessages: selected,
      ...(source.agentProfile ? { agentProfile: source.agentProfile } : {}),
    });
    await sourceActor.recordFork(forked.sessionId, input.messageId);
    return forked;
  }

  private relationship(source: SessionCatalogRecord, target: SessionCatalogRecord): AgentMessageRelationship | undefined {
    if (source.familyId !== target.familyId || source.sessionId === target.sessionId) return undefined;
    if (source.parentSessionId === target.sessionId) return "parent";
    if (target.parentSessionId === source.sessionId) return "child";
    if (source.parentSessionId && source.parentSessionId === target.parentSessionId) return "sibling";
    return undefined;
  }

  async familyRoster(sessionId: string): Promise<AgentFamilyRosterEntry[]> {
    await this.loadCatalog();
    const source = this.catalog.find((item) => item.sessionId === sessionId);
    if (!source) throw new Error(`Session ${sessionId} does not exist.`);
    const entries: AgentFamilyRosterEntry[] = [];
    for (const target of this.catalog) {
      const relationship = this.relationship(source, target);
      if (!relationship) continue;
      const active = this.actors.get(target.sessionId)?.state;
      const persisted = active ?? await this.options.snapshotStore.load(target.sessionId);
      if (!persisted || persisted.tenantId !== source.tenantId) continue;
      entries.push({
        sessionId: target.sessionId,
        name: target.name,
        relationship,
        status: persisted.status,
        generation: persisted.generation,
      });
    }
    const order: Record<AgentMessageRelationship, number> = { parent: 0, sibling: 1, child: 2 };
    return entries.sort((left, right) => order[left.relationship] - order[right.relationship] || left.name.localeCompare(right.name));
  }

  private consumeAgentMessageRate(senderSessionId: string): void {
    const capacity = this.options.agentMessageRateCapacity ?? 3;
    const refillMs = this.options.agentMessageRateRefillMs ?? 1000;
    const now = Date.now();
    const current = this.messageRate.get(senderSessionId) ?? { tokens: capacity, updatedAt: now };
    const refilled = Math.min(capacity, current.tokens + (now - current.updatedAt) / refillMs);
    if (refilled < 1) throw new Error("Agent message rate limit exceeded.");
    this.messageRate.set(senderSessionId, { tokens: refilled - 1, updatedAt: now });
  }

  private async resolveMessageTargets(input: {
    senderSessionId: string;
    targetSessionId?: string;
    receiverRole?: AgentMessageRelationship;
    receiverName?: string;
    broadcast?: boolean;
  }): Promise<AgentFamilyRosterEntry[]> {
    const roster = await this.familyRoster(input.senderSessionId);
    if (input.broadcast) {
      if (input.targetSessionId || input.receiverRole || input.receiverName) throw new Error("Broadcast cannot be combined with a specific receiver.");
      if (roster.length === 0) throw new Error("No directly reachable family agents are available for broadcast.");
      return roster;
    }
    let matches: AgentFamilyRosterEntry[];
    if (input.targetSessionId) {
      matches = roster.filter((entry) => entry.sessionId === input.targetSessionId);
    } else if (input.receiverRole) {
      matches = roster.filter((entry) => entry.relationship === input.receiverRole);
      if (input.receiverRole !== "parent") {
        if (!input.receiverName?.trim()) throw new Error("receiverName is required for sibling and child messages.");
        matches = matches.filter((entry) => entry.name === input.receiverName!.trim());
      } else if (input.receiverName) {
        throw new Error("receiverName must be omitted for parent messages.");
      }
    } else {
      throw new Error("A targetSessionId, receiverRole, or broadcast=true is required.");
    }
    if (matches.length === 0) throw new Error("Target is outside direct parent/sibling/child family reach or does not exist.");
    if (matches.length > 1) throw new Error("Agent receiver name is ambiguous within the requested family role.");
    return matches;
  }

  private receipt(message: AgentInboxMessage): AgentMessageReceipt {
    return {
      id: message.id,
      targetSessionId: message.targetSessionId,
      targetName: message.targetName,
      relationship: message.relationship,
      requestedMode: message.requestedMode,
      effectiveMode: message.effectiveMode,
      deliveryStatus: message.state === "delivered" ? "delivered" : "queued",
      queuedAt: message.createdAt,
      ...(message.deliveredAt ? { deliveredAt: message.deliveredAt } : {}),
    };
  }

  async sendAgentMessage(input: {
    senderSessionId: string;
    message: string;
    mode?: AgentMessageDeliveryMode;
    targetSessionId?: string;
    receiverRole?: AgentMessageRelationship;
    receiverName?: string;
    broadcast?: boolean;
  }): Promise<{ receipts: AgentMessageReceipt[] }> {
    const text = input.message.trim();
    const maxChars = this.options.agentMessageMaxChars ?? 16_384;
    if (!text || text.length > maxChars) throw new Error(`Agent message must contain 1 to ${maxChars} characters.`);
    const sender = await this.getSession(input.senderSessionId);
    if (sender.status === "closed") throw new Error("Closed agents cannot send messages.");
    this.consumeAgentMessageRate(input.senderSessionId);
    const targets = await this.resolveMessageTargets(input);
    const maxPending = this.options.agentMessageMaxPending ?? 20;
    for (const target of targets) {
      if (await this.agentInbox.pendingCount(target.sessionId) >= maxPending) {
        throw new Error(`Target session ${target.sessionId} has reached the ${maxPending}-message pending limit.`);
      }
    }

    const requestedMode = input.mode ?? "auto";
    const records: AgentInboxMessage[] = [];
    for (const target of targets) {
      const busy = !["idle", "ready"].includes(target.status);
      const effectiveMode = requestedMode === "auto" ? (busy ? "steer" : "follow_up") : requestedMode;
      const record = newAgentInboxMessage({
        tenantId: sender.tenantId,
        familyId: sender.familyId,
        senderSessionId: sender.sessionId,
        senderName: sender.name,
        targetSessionId: target.sessionId,
        targetName: target.name,
        relationship: target.relationship === "parent" ? "child" : target.relationship === "child" ? "parent" : "sibling",
        requestedMode,
        effectiveMode,
        text,
      });
      await this.agentInbox.enqueue(record);
      records.push(record);
    }

    const idleRecords = records.filter((record) => {
      const target = targets.find((item) => item.sessionId === record.targetSessionId)!;
      return ["idle", "ready"].includes(target.status);
    });
    const waits = idleRecords.map((record) => new Promise<AgentInboxMessage>((resolvePromise, reject) => {
      this.deliveryWaiters.set(record.id, { resolve: resolvePromise, reject });
    }));
    for (const record of records) queueMicrotask(() => void this.drainAgentInbox(record.targetSessionId));

    if (waits.length > 0) {
      const timeout = new Promise<undefined>((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise(undefined), 500);
        timer.unref();
      });
      await Promise.race([Promise.allSettled(waits), timeout]);
      for (const record of idleRecords) this.deliveryWaiters.delete(record.id);
    }
    const current = await Promise.all(records.map(async (record) => await this.agentInbox.get(record.id, record.targetSessionId) ?? record));
    return { receipts: current.map((record) => this.receipt(record)) };
  }

  async listAgentInbox(sessionId: string, states?: AgentInboxMessage["state"][]): Promise<AgentInboxMessage[]> {
    await this.getSession(sessionId);
    return await this.agentInbox.list(sessionId, states);
  }

  private async claimSteeringMessages(sessionId: string): Promise<AgentInboxMessage[]> {
    const claimed: AgentInboxMessage[] = [];
    const limit = this.options.agentMessageMaxPending ?? 20;
    for (let index = 0; index < limit; index++) {
      const message = await this.agentInbox.claimNext(sessionId, ["steer"], this.inboxOwnerId);
      if (!message) break;
      claimed.push(message);
    }
    return claimed;
  }

  private async markInboxDelivered(message: AgentInboxMessage, deliveredAt: string): Promise<void> {
    const delivered = await this.agentInbox.markDelivered(message.id, message.targetSessionId, message.ownerId ?? this.inboxOwnerId, deliveredAt);
    this.deliveryWaiters.get(message.id)?.resolve(delivered);
    this.deliveryWaiters.delete(message.id);
  }

  private async markInboxUncertain(message: AgentInboxMessage, reason: string): Promise<void> {
    try {
      await this.agentInbox.markUncertain(message.id, message.targetSessionId, message.ownerId ?? this.inboxOwnerId, reason);
    } finally {
      this.deliveryWaiters.get(message.id)?.reject(new Error(`Agent message delivery is uncertain: ${reason}`));
      this.deliveryWaiters.delete(message.id);
    }
  }

  private formattedAgentMessage(message: AgentInboxMessage): string {
    return [
      "Agent-to-agent message received.",
      `From ${message.relationship} agent ${JSON.stringify(message.senderName)} (${message.senderSessionId}):`,
      message.text,
    ].join("\n");
  }

  private async deliverClaimedMessage(message: AgentInboxMessage): Promise<void> {
    let accepted = false;
    const result = await this.dispatch({
      protocolVersion: 1,
      commandId: message.commandId,
      clientId: `agent-inbox:${message.senderSessionId}`,
      tenantId: message.tenantId,
      sessionId: message.targetSessionId,
      kind: "agent.message",
      source: "agent",
      issuedAt: message.createdAt,
      payload: {
        text: this.formattedAgentMessage(message),
        senderSessionId: message.senderSessionId,
        agentInboxMessageId: message.id,
        deliveryMode: message.effectiveMode,
      },
    }, {
      onPromptAccepted: async (_messageId, acceptedAt) => {
        await this.markInboxDelivered(message, acceptedAt);
        accepted = true;
      },
    });
    if (!accepted) {
      await this.markInboxUncertain(message, `command_${result.status}:${result.error?.code ?? "not_accepted"}`);
    }
  }

  private async drainAgentInbox(sessionId: string): Promise<void> {
    if (this.inboxDrains.has(sessionId)) return;
    this.inboxDrains.add(sessionId);
    try {
      while (true) {
        const actor = await this.getActor(sessionId);
        if (!["idle", "ready"].includes(actor.state.status)) return;
        const message = await this.agentInbox.claimNext(sessionId, ["follow_up", "steer"], this.inboxOwnerId);
        if (!message) return;
        try {
          await this.deliverClaimedMessage(message);
        } catch (error) {
          await this.markInboxUncertain(message, `delivery_exception:${error instanceof Error ? error.name : "unknown"}`).catch(() => undefined);
          return;
        }
      }
    } catch {
      // Another process may own the session lease. The durable pending row stays
      // available for that owner; observers must not turn this into a crash loop.
    } finally {
      this.inboxDrains.delete(sessionId);
    }
  }

  async dispatch(command: CommandEnvelope, hooks: SessionDispatchHooks = {}): Promise<CommandResult> {
    const result = await this.options.commandJournal.execute(command, async () => {
      const actor = await this.getActor(command.sessionId);
      if (actor.state.tenantId !== command.tenantId) {
        return {
          commandId: command.commandId,
          status: "rejected",
          error: { code: "TENANT_MISMATCH", message: "Session does not belong to the command tenant.", retryable: false },
        };
      }
      return await actor.dispatch(command, hooks);
    });
    if (command.kind !== "session.cancel") queueMicrotask(() => void this.drainAgentInbox(command.sessionId));
    return result;
  }

  async getActor(sessionId: string): Promise<SessionActor> {
    const active = this.actors.get(sessionId);
    if (active) return active;
    await this.loadCatalog();
    const record = this.catalog.find((item) => item.sessionId === sessionId);
    if (!record) throw new Error(`Session ${sessionId} does not exist.`);
    const persisted = await this.options.snapshotStore.load(sessionId);
    if (!persisted) throw new Error(`Session ${sessionId} has no snapshot.`);
    const { activeTurnId: _retiredTurn, ...persistedWithoutActiveTurn } = persisted;
    const snapshot: SessionSnapshot = {
      ...persistedWithoutActiveTurn,
      generation: persisted.generation + 1,
      lastSequence: await this.options.eventStore.lastSequence(sessionId),
      status: "recovering",
    };
    await this.leases.acquire(sessionId);
    const actor = await this.buildActor(snapshot, true);
    this.actors.set(sessionId, actor);
    await actor.initialize(true);
    return actor;
  }

  async getSession(sessionId: string): Promise<SessionSnapshot> {
    return (await this.getActor(sessionId)).state;
  }

  async taskActionFromCapability(sessionId: string, action: string, payload: Record<string, JsonValue>, turnId: string): Promise<JsonValue> {
    return await (await this.getActor(sessionId)).taskActionFromCapability(action, payload, turnId);
  }

  async listSessions(tenantId?: string): Promise<SessionSnapshot[]> {
    await this.loadCatalog();
    const output: SessionSnapshot[] = [];
    for (const record of this.catalog) {
      if (tenantId && record.tenantId !== tenantId) continue;
      try {
        output.push((await this.getActor(record.sessionId)).state);
      } catch {
        // A corrupt individual session must not hide the rest of the catalog.
      }
    }
    return output.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async buildActor(snapshot: SessionSnapshot, _recovered: boolean): Promise<SessionActor> {
    const frozenContext = await this.options.context.freeze(snapshot.tenantId, snapshot.sessionId, snapshot.agentProfile);
    return new SessionActor({
      snapshot,
      eventStore: this.options.eventStore,
      snapshotStore: this.options.snapshotStore,
      model: this.options.model,
      capabilities: this.options.capabilities,
      context: this.options.context,
      frozenContext,
      ...(this.options.modelName ? { modelName: this.options.modelName } : {}),
      ...(this.options.modelFallbacks?.length ? { modelFallbacks: this.options.modelFallbacks } : {}),
      claimSteeringMessages: async (sessionId) => await this.claimSteeringMessages(sessionId),
      markInboxDelivered: async (message, deliveredAt) => await this.markInboxDelivered(message, deliveredAt),
      markInboxUncertain: async (message, reason) => await this.markInboxUncertain(message, reason),
      onClose: async (sessionId) => {
        await this.options.onSessionClose?.(sessionId);
        this.actors.delete(sessionId);
        await this.leases.release(sessionId);
      },
    });
  }

  async shutdown(): Promise<void> {
    this.capabilityUnsubscribe?.();
    this.capabilityUnsubscribe = undefined;
    this.inboxUnsubscribe?.();
    this.inboxUnsubscribe = undefined;
    for (const waiter of this.deliveryWaiters.values()) waiter.reject(new Error("Supervisor shut down before message delivery confirmation."));
    this.deliveryWaiters.clear();
    this.inboxDrains.clear();
    this.actors.clear();
    await this.leases.releaseAll();
  }
}
