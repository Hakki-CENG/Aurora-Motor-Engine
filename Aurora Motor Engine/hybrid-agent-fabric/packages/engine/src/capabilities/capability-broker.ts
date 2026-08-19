import type {
  Capability,
  CapabilityContext,
  CapabilityDescriptor,
  JsonValue,
  PolicyDecision,
} from "../types.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import { ApprovalService } from "../policy/approval-service.js";
import type { EffectJournalLike } from "../persistence/effect-journal.js";
import type { HookBus } from "../plugins/hook-bus.js";

export interface CapabilityLifecycleEvent {
  phase: "policy" | "approval" | "started" | "finished";
  descriptor: CapabilityDescriptor;
  context: CapabilityContext;
  decision?: PolicyDecision;
  status?: "ok" | "error" | "blocked";
  durationMs?: number;
  error?: string;
}

export type CapabilityLifecycleListener = (event: CapabilityLifecycleEvent) => void | Promise<void>;

export class CapabilityBroker {
  private readonly capabilities = new Map<string, Capability>();
  private readonly listeners = new Set<CapabilityLifecycleListener>();

  constructor(
    private readonly policy: PolicyEngine,
    readonly approvals: ApprovalService,
    private readonly effects: EffectJournalLike,
    private readonly hooks?: HookBus,
  ) {}

  register(capability: Capability): void {
    if (this.capabilities.has(capability.descriptor.id)) {
      throw new Error(`Capability ${capability.descriptor.id} is already registered.`);
    }
    this.capabilities.set(capability.descriptor.id, capability);
  }

  unregister(id: string): boolean {
    return this.capabilities.delete(id);
  }

  list(): CapabilityDescriptor[] {
    return [...this.capabilities.values()].map(({ descriptor }) => descriptor);
  }

  subscribe(listener: CapabilityLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async execute(id: string, rawInput: unknown, context: CapabilityContext): Promise<JsonValue> {
    if (context.allowedCapabilityIds && !context.allowedCapabilityIds.includes(id)) {
      throw new Error(`Capability ${id} is not allowed by this session's agent profile.`);
    }
    const capability = this.capabilities.get(id);
    if (!capability) throw new Error(`Unknown capability: ${id}`);
    const input = capability.validate(rawInput);
    const guard = await this.hooks?.invokeGuard("pre_capability", {
      capability: capability.descriptor,
      arguments: input,
      context: {
        tenantId: context.tenantId,
        sessionId: context.sessionId,
        turnId: context.turnId,
        source: context.source,
      },
    });
    if (guard?.decision === "deny") {
      throw new Error(guard.reason ?? `A security plugin denied ${id}.`);
    }
    const decision = await this.policy.decide({ descriptor: capability.descriptor, arguments: input, context });
    await this.emit({ phase: "policy", descriptor: capability.descriptor, context, decision });

    if (decision.decision === "deny") {
      await this.emit({ phase: "finished", descriptor: capability.descriptor, context, status: "blocked", error: decision.message });
      throw new Error(`Policy denied ${id}: ${decision.message}`);
    }
    if (decision.decision === "require_approval") {
      await this.emit({ phase: "approval", descriptor: capability.descriptor, context, decision });
      const approved = await this.approvals.request(capability.descriptor, input, context, decision.message);
      if (!approved) {
        await this.emit({ phase: "finished", descriptor: capability.descriptor, context, status: "blocked", error: "Approval denied or expired." });
        throw new Error(`Approval denied for ${id}.`);
      }
    }

    const start = Date.now();
    await this.emit({ phase: "started", descriptor: capability.descriptor, context });
    try {
      const operation = () => capability.execute(input, context);
      const result = capability.descriptor.sideEffect
        ? await this.effects.execute(context.idempotencyKey, operation, context.tenantId)
        : await operation();
      await this.emit({ phase: "finished", descriptor: capability.descriptor, context, status: "ok", durationMs: Date.now() - start });
      this.hooks?.emitObserver("post_capability", {
        capabilityId: capability.descriptor.id,
        status: "ok",
        durationMs: Date.now() - start,
        sessionId: context.sessionId,
        turnId: context.turnId,
      });
      return result;
    } catch (error) {
      await this.emit({
        phase: "finished",
        descriptor: capability.descriptor,
        context,
        status: "error",
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      this.hooks?.emitObserver("post_capability", {
        capabilityId: capability.descriptor.id,
        status: "error",
        durationMs: Date.now() - start,
        errorClass: error instanceof Error ? error.name : "unknown",
        sessionId: context.sessionId,
        turnId: context.turnId,
      });
      throw error;
    }
  }

  private async emit(event: CapabilityLifecycleEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await Promise.race([
          listener(event),
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1000);
            timer.unref();
          }),
        ]);
      } catch {
        // Lifecycle observers are fail-open and bounded.
      }
    }
  }
}
