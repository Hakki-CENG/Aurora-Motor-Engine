/**
 * Agent SDK Service
 * Third-party extension framework for securely writing new tools,
 * workflows, expert agents and integrations.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DurableJsonState } from "../util/aurora-state.js";

// ─── Types ───

export type ExtensionType = "tool" | "workflow" | "agent" | "connector" | "transformer" | "validator";
export type ExtensionStatus = "draft" | "review" | "approved" | "published" | "deprecated" | "revoked";

export interface Extension {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: ExtensionType;
  version: string;
  author: string;
  status: ExtensionStatus;
  manifest: ExtensionManifest;
  permissions: ExtensionPermissions;
  signature?: string;
  publishedAt?: string;
  deprecatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionManifest {
  entrypoint: string;
  runtime: "javascript" | "typescript" | "python" | "wasm";
  dependencies: string[];
  config: ExtensionConfig[];
  hooks: ExtensionHook[];
  capabilities: string[];
  minEngineVersion: string;
}

export interface ExtensionConfig {
  key: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  default?: unknown;
  description: string;
}

export interface ExtensionHook {
  event: string;
  handler: string;
  priority: number;
}

export interface ExtensionPermissions {
  filesystem: { read: string[]; write: string[] };
  network: { allowed: string[]; blocked: string[] };
  database: { read: string[]; write: string[] };
  capabilities: string[];
  maxExecutionMs: number;
  maxMemoryMb: number;
}

export interface ExtensionInstance {
  id: string;
  extensionId: string;
  tenantId: string;
  config: Record<string, unknown>;
  status: "active" | "paused" | "error";
  lastExecuted?: string;
  executionCount: number;
  errorCount: number;
  createdAt: string;
}

export interface ExtensionExecution {
  id: string;
  instanceId: string;
  tenantId: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs: number;
  status: "success" | "error" | "timeout" | "cancelled";
  startedAt: string;
  completedAt?: string;
}

export interface ExtensionReview {
  id: string;
  extensionId: string;
  reviewer: string;
  rating: number; // 1-5
  comment: string;
  securityScore: number; // 0-100
  approved: boolean;
  findings: ReviewFinding[];
  createdAt: string;
}

export interface ReviewFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "security" | "performance" | "quality" | "compatibility";
  description: string;
  recommendation: string;
}

export interface SDKConfig {
  allowUnsigned: boolean;
  maxExtensionsPerTenant: number;
  reviewRequired: boolean;
  sandboxMode: "strict" | "moderate" | "permissive";
  allowedRuntimes: ExtensionManifest["runtime"][];
}

// ─── State ───

interface SDKState {
  schemaVersion: number;
  extensions: Extension[];
  instances: ExtensionInstance[];
  executions: ExtensionExecution[];
  reviews: ExtensionReview[];
  config: SDKConfig;
}

export class AgentSDKService {
  private store: DurableJsonState<SDKState>;

  constructor(private baseDir: string) {
    this.store = new DurableJsonState<SDKState>(
      join(baseDir, "agent-sdk.json"),
      () => ({
        schemaVersion: 1, extensions: [], instances: [], executions: [], reviews: [],
        config: {
          allowUnsigned: false,
          maxExtensionsPerTenant: 50,
          reviewRequired: true,
          sandboxMode: "strict",
          allowedRuntimes: ["javascript", "typescript", "wasm"],
        },
      }),
      (v) => { const s = v as SDKState; return !!s && s.schemaVersion === 1; },
      "Agent SDK service",
    );
  }

  async init(): Promise<void> { await this.store.read(); }

  // ─── Extension Registration ───

  async registerExtension(tenantId: string, extension: Omit<Extension, "id" | "status" | "createdAt" | "updatedAt">): Promise<Extension> {
    const s = await this.store.read();

    // Check limits
    const tenantExtensions = s.extensions.filter(e => e.tenantId === tenantId);
    if (tenantExtensions.length >= s.config.maxExtensionsPerTenant) {
      throw new Error(`Maximum extensions per tenant reached (${s.config.maxExtensionsPerTenant})`);
    }

    // Check runtime
    if (!s.config.allowedRuntimes.includes(extension.manifest.runtime)) {
      throw new Error(`Runtime "${extension.manifest.runtime}" is not allowed`);
    }

    const newExtension: Extension = {
      ...extension,
      id: randomUUID(),
      status: s.config.reviewRequired ? "draft" : "approved",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.store.mutate(s => { s.extensions.push(newExtension); });
    return newExtension;
  }

  async getExtensions(tenantId: string, type?: ExtensionType, status?: ExtensionStatus): Promise<Extension[]> {
    const s = await this.store.read();
    return s.extensions.filter(e =>
      e.tenantId === tenantId &&
      (!type || e.type === type) &&
      (!status || e.status === status)
    );
  }

  async getExtension(id: string): Promise<Extension | undefined> {
    const s = await this.store.read();
    return s.extensions.find(e => e.id === id);
  }

  async updateExtensionStatus(extensionId: string, status: ExtensionStatus): Promise<void> {
    await this.store.mutate(s => {
      const e = s.extensions.find(x => x.id === extensionId);
      if (e) {
        e.status = status;
        e.updatedAt = new Date().toISOString();
        if (status === "published") e.publishedAt = new Date().toISOString();
        if (status === "deprecated") e.deprecatedAt = new Date().toISOString();
      }
    });
  }

  // ─── Instance Management ───

  async createInstance(extensionId: string, tenantId: string, config: Record<string, unknown> = {}): Promise<ExtensionInstance> {
    const extension = await this.getExtension(extensionId);
    if (!extension) throw new Error(`Extension not found: ${extensionId}`);
    if (extension.status !== "published" && extension.status !== "approved") {
      throw new Error(`Extension is not in a runnable state: ${extension.status}`);
    }

    // Validate config against manifest
    this.validateConfig(config, extension.manifest.config);

    const instance: ExtensionInstance = {
      id: randomUUID(),
      extensionId,
      tenantId,
      config,
      status: "active",
      executionCount: 0,
      errorCount: 0,
      createdAt: new Date().toISOString(),
    };

    await this.store.mutate(s => { s.instances.push(instance); });
    return instance;
  }

  async getInstances(tenantId: string, extensionId?: string): Promise<ExtensionInstance[]> {
    const s = await this.store.read();
    return s.instances.filter(i => i.tenantId === tenantId && (!extensionId || i.extensionId === extensionId));
  }

  async deleteInstance(instanceId: string): Promise<void> {
    await this.store.mutate(s => {
      s.instances = s.instances.filter(i => i.id !== instanceId);
    });
  }

  // ─── Execution ───

  async execute(instanceId: string, tenantId: string, input: unknown): Promise<ExtensionExecution> {
    const s = await this.store.read();
    const instance = s.instances.find(i => i.id === instanceId && i.tenantId === tenantId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);
    if (instance.status !== "active") throw new Error(`Instance is not active: ${instance.status}`);

    const extension = s.extensions.find(e => e.id === instance.extensionId);
    if (!extension) throw new Error(`Extension not found`);

    const start = Date.now();
    const execution: ExtensionExecution = {
      id: randomUUID(),
      instanceId,
      tenantId,
      input,
      status: "success",
      durationMs: 0,
      startedAt: new Date().toISOString(),
    };

    try {
      // Execute in sandbox
      const output = await this.executeInSandbox(extension, instance, input);
      execution.output = output;
      execution.status = "success";
    } catch (err: unknown) {
      execution.error = err instanceof Error ? err.message : String(err);
      execution.status = "error";
    }

    execution.durationMs = Date.now() - start;
    execution.completedAt = new Date().toISOString();

    await this.store.mutate(s => {
      s.executions.push(execution);
      const inst = s.instances.find(i => i.id === instanceId);
      if (inst) {
        inst.executionCount++;
        inst.lastExecuted = new Date().toISOString();
        if (execution.status === "error") inst.errorCount++;
      }
    });

    return execution;
  }

  async getExecutions(tenantId: string, instanceId?: string, limit: number = 50): Promise<ExtensionExecution[]> {
    const s = await this.store.read();
    return s.executions
      .filter(e => e.tenantId === tenantId && (!instanceId || e.instanceId === instanceId))
      .slice(-limit);
  }

  // ─── Reviews ───

  async submitReview(extensionId: string, review: Omit<ExtensionReview, "id" | "createdAt">): Promise<ExtensionReview> {
    const newReview: ExtensionReview = {
      ...review,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.store.mutate(s => { s.reviews.push(newReview); });

    // Auto-approve if security score is high enough
    if (review.approved && review.securityScore >= 80) {
      await this.updateExtensionStatus(extensionId, "approved");
    }

    return newReview;
  }

  async getReviews(extensionId: string): Promise<ExtensionReview[]> {
    const s = await this.store.read();
    return s.reviews.filter(r => r.extensionId === extensionId);
  }

  // ─── SDK Config ───

  async getConfig(): Promise<SDKConfig> {
    const s = await this.store.read();
    return s.config;
  }

  async updateConfig(config: Partial<SDKConfig>): Promise<void> {
    await this.store.mutate(s => { Object.assign(s.config, config); });
  }

  // ─── Signing ───

  async signExtension(extensionId: string, privateKey: string): Promise<string> {
    // In production, cryptographically sign the extension
    const signature = randomUUID();
    await this.store.mutate(s => {
      const e = s.extensions.find(x => x.id === extensionId);
      if (e) e.signature = signature;
    });
    return signature;
  }

  async verifySignature(extensionId: string): Promise<boolean> {
    const extension = await this.getExtension(extensionId);
    if (!extension) return false;
    const config = await this.getConfig();
    if (config.allowUnsigned) return true;
    return !!extension.signature;
  }

  // ─── Stats ───

  async getStats(tenantId: string) {
    const s = await this.store.read();
    const extensions = s.extensions.filter(e => e.tenantId === tenantId);
    const instances = s.instances.filter(i => i.tenantId === tenantId);
    const executions = s.executions.filter(e => e.tenantId === tenantId);
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const e of extensions) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    }
    return {
      totalExtensions: extensions.length,
      totalInstances: instances.length,
      totalExecutions: executions.length,
      byType,
      byStatus,
      successRate: executions.length > 0 ? executions.filter(e => e.status === "success").length / executions.length : 0,
      avgDurationMs: executions.length > 0 ? executions.reduce((s, e) => s + e.durationMs, 0) / executions.length : 0,
    };
  }

  // ─── Private Helpers ───

  private validateConfig(config: Record<string, unknown>, schema: ExtensionConfig[]): void {
    for (const field of schema) {
      if (field.required && !(field.key in config)) {
        throw new Error(`Required config field missing: ${field.key}`);
      }
    }
  }

  private async executeInSandbox(extension: Extension, instance: ExtensionInstance, input: unknown): Promise<unknown> {
    // In production, execute in isolated sandbox (WASI, VM, etc.)
    return { success: true, extension: extension.name, input };
  }
}
