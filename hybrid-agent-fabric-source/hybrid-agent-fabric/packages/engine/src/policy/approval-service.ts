import { randomUUID } from "node:crypto";
import type { ApprovalRequest, CapabilityContext, CapabilityDescriptor, JsonValue } from "../types.js";
import { safePreview } from "../util/json.js";

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

export type ApprovalListener = (request: ApprovalRequest) => void;

export class ApprovalService {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly listeners = new Set<ApprovalListener>();
  private readonly sessionGrants = new Set<string>();

  constructor(private readonly defaultTimeoutMs = 5 * 60_000) {}

  subscribe(listener: ApprovalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(sessionId?: string): ApprovalRequest[] {
    return [...this.pending.values()]
      .map(({ request }) => request)
      .filter((request) => !sessionId || request.sessionId === sessionId);
  }

  hasSessionGrant(sessionId: string, capabilityId: string): boolean {
    return this.sessionGrants.has(`${sessionId}:${capabilityId}`);
  }

  async request(
    descriptor: CapabilityDescriptor,
    argumentsValue: Record<string, JsonValue>,
    context: CapabilityContext,
    reason: string,
  ): Promise<boolean> {
    if (this.hasSessionGrant(context.sessionId, descriptor.id)) return true;
    const id = randomUUID();
    const now = Date.now();
    const request: ApprovalRequest = {
      id,
      tenantId: context.tenantId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      toolCallId: context.toolCallId,
      capabilityId: descriptor.id,
      risk: descriptor.risk,
      argumentsPreview: safePreview(argumentsValue),
      reason,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.defaultTimeoutMs).toISOString(),
      status: "pending",
    };

    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        pending.request.status = "expired";
        this.pending.delete(id);
        resolve(false);
        this.notify(pending.request);
      }, this.defaultTimeoutMs);
      timer.unref();
      this.pending.set(id, { request, resolve, timer });
      this.notify(request);
    });
  }

  resolve(id: string, decision: "approve_once" | "approve_session" | "deny"): ApprovalRequest {
    const pending = this.pending.get(id);
    if (!pending) throw new Error(`Approval ${id} is not pending.`);
    clearTimeout(pending.timer);
    pending.request.status = decision === "deny" ? "denied" : "approved";
    if (decision === "approve_session") {
      this.sessionGrants.add(`${pending.request.sessionId}:${pending.request.capabilityId}`);
    }
    this.pending.delete(id);
    pending.resolve(decision !== "deny");
    this.notify(pending.request);
    return pending.request;
  }

  clearSession(sessionId: string): void {
    for (const [key, pending] of this.pending) {
      if (pending.request.sessionId !== sessionId) continue;
      clearTimeout(pending.timer);
      pending.request.status = "denied";
      pending.resolve(false);
      this.pending.delete(key);
    }
    for (const grant of this.sessionGrants) {
      if (grant.startsWith(`${sessionId}:`)) this.sessionGrants.delete(grant);
    }
  }

  private notify(request: ApprovalRequest): void {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(request));
      } catch {
        // Approval observers cannot affect the decision.
      }
    }
  }
}
