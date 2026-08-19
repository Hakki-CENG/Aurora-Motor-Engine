import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityBroker } from "../capabilities/capability-broker.js";
import type { Supervisor } from "../runtime/supervisor.js";
import type { LearningGovernor } from "./learning-governor.js";
import { atomicWrite } from "../util/atomic-file.js";

export type LearningReleaseStatus =
  | "draft"
  | "evaluating"
  | "evaluation_failed"
  | "awaiting_signature"
  | "canary"
  | "promoted"
  | "rolled_back";

export interface LearningRelease {
  id: string;
  candidateId: string;
  tenantId: string;
  sessionId: string;
  status: LearningReleaseStatus;
  evalCommands: string[];
  evaluation: Array<{ command: string; exitCode: number | null; outputHash: string; outputPreview: string }>;
  canary: {
    percentage: number;
    minSamples: number;
    requiredSuccessRate: number;
    successes: number;
    failures: number;
  };
  signature?: { keyId: string; value: string; verifiedAt: string };
  createdAt: string;
  updatedAt: string;
}

export class LearningRolloutManager {
  private releases: LearningRelease[] = [];
  private loaded = false;

  constructor(
    private readonly rootPath: string,
    private readonly governor: LearningGovernor,
    private readonly broker: CapabilityBroker,
    private readonly supervisor: Supervisor,
    private readonly trustedPublicKeys: Record<string, string>,
  ) {}

  private get path(): string { return join(this.rootPath, "learning", "releases.json"); }
  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      this.releases = Array.isArray(parsed) ? parsed as LearningRelease[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }
  private async save(): Promise<void> { await atomicWrite(this.path, `${JSON.stringify(this.releases, null, 2)}\n`); }

  static signaturePayload(release: LearningRelease): Buffer {
    return Buffer.from(JSON.stringify({
      id: release.id,
      candidateId: release.candidateId,
      tenantId: release.tenantId,
      sessionId: release.sessionId,
      evalCommands: release.evalCommands,
      evaluation: release.evaluation,
      canary: {
        percentage: release.canary.percentage,
        minSamples: release.canary.minSamples,
        requiredSuccessRate: release.canary.requiredSuccessRate,
      },
    }));
  }

  async create(input: {
    candidateId: string;
    evalCommands: string[];
    canaryPercentage?: number;
    minSamples?: number;
    requiredSuccessRate?: number;
  }): Promise<LearningRelease> {
    await this.load();
    const candidate = await this.governor.get(input.candidateId);
    if (candidate.status !== "scanned" && candidate.status !== "evaluated" && candidate.status !== "approved") {
      throw new Error(`Learning candidate cannot enter rollout from status ${candidate.status}.`);
    }
    const commands = input.evalCommands.map((command) => command.trim()).filter(Boolean).slice(0, 20);
    if (!commands.length) throw new Error("At least one evaluation command is required.");
    const now = new Date().toISOString();
    const release: LearningRelease = {
      id: randomUUID(),
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      sessionId: candidate.sessionId,
      status: "draft",
      evalCommands: commands,
      evaluation: [],
      canary: {
        percentage: Math.min(Math.max(input.canaryPercentage ?? 10, 1), 100),
        minSamples: Math.min(Math.max(input.minSamples ?? 10, 1), 10_000),
        requiredSuccessRate: Math.min(Math.max(input.requiredSuccessRate ?? 0.95, 0.5), 1),
        successes: 0,
        failures: 0,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.releases.push(release);
    await this.save();
    return structuredClone(release);
  }

  async list(tenantId: string): Promise<LearningRelease[]> {
    await this.load();
    return this.releases.filter((release) => release.tenantId === tenantId).map((release) => structuredClone(release));
  }

  async get(id: string): Promise<LearningRelease> {
    await this.load();
    return structuredClone(this.require(id));
  }

  async runEvaluation(id: string): Promise<LearningRelease> {
    await this.load();
    const release = this.require(id);
    if (release.status !== "draft" && release.status !== "evaluation_failed") throw new Error(`Release cannot evaluate from status ${release.status}.`);
    release.status = "evaluating";
    release.evaluation = [];
    release.updatedAt = new Date().toISOString();
    await this.save();
    const session = await this.supervisor.getSession(release.sessionId);
    for (let index = 0; index < release.evalCommands.length; index++) {
      const command = release.evalCommands[index]!;
      const result = await this.broker.execute("process.exec", {
        command,
        timeoutMs: 10 * 60_000,
        maxOutputChars: 20_000,
      }, {
        tenantId: release.tenantId,
        sessionId: release.sessionId,
        familyId: session.familyId,
        turnId: `learning-eval:${release.id}`,
        toolCallId: `eval-${index}`,
        source: "api",
        workspacePath: session.workspacePath,
        idempotencyKey: `learning:${release.id}:eval:${index}:${release.evaluation.length}`,
      }) as Record<string, unknown>;
      const output = typeof result.stdout === "string" ? result.stdout : JSON.stringify(result);
      const exitCode = typeof result.exitCode === "number" ? result.exitCode : null;
      release.evaluation.push({
        command,
        exitCode,
        outputHash: createHash("sha256").update(output).digest("hex"),
        outputPreview: output.slice(0, 2000),
      });
      if (exitCode !== 0) break;
    }
    const passed = release.evaluation.length === release.evalCommands.length && release.evaluation.every((result) => result.exitCode === 0);
    await this.governor.recordEvaluation(release.candidateId, {
      passed,
      checks: release.evaluation.map((result) => `command:${result.command}:exit=${result.exitCode}`),
      summary: passed ? "All automated release checks passed." : "At least one automated release check failed.",
    });
    release.status = passed ? "awaiting_signature" : "evaluation_failed";
    release.updatedAt = new Date().toISOString();
    await this.save();
    return structuredClone(release);
  }

  async submitSignature(id: string, input: { keyId: string; signature: string }): Promise<LearningRelease> {
    await this.load();
    const release = this.require(id);
    if (release.status !== "awaiting_signature") throw new Error(`Release cannot be signed from status ${release.status}.`);
    const trusted = this.trustedPublicKeys[input.keyId];
    if (!trusted) throw new Error("Learning release signing key is not trusted.");
    if (!verify(null, LearningRolloutManager.signaturePayload(release), publicKey(trusted), Buffer.from(input.signature, "base64"))) {
      throw new Error("Learning release signature is invalid.");
    }
    const candidate = await this.governor.get(release.candidateId);
    if ((candidate.scope === "user" || candidate.scope === "org" || candidate.risk === "high") && candidate.status !== "approved") {
      throw new Error("High-scope learning candidate still requires human review approval.");
    }
    release.signature = { keyId: input.keyId, value: input.signature, verifiedAt: new Date().toISOString() };
    release.status = "canary";
    release.updatedAt = new Date().toISOString();
    await this.save();
    return structuredClone(release);
  }

  async recordOutcome(id: string, success: boolean): Promise<LearningRelease> {
    await this.load();
    const release = this.require(id);
    if (release.status !== "canary") throw new Error(`Release is not in canary status.`);
    success ? release.canary.successes++ : release.canary.failures++;
    const samples = release.canary.successes + release.canary.failures;
    if (samples >= release.canary.minSamples) {
      const rate = release.canary.successes / samples;
      if (rate >= release.canary.requiredSuccessRate) {
        await this.governor.promote(release.candidateId);
        release.status = "promoted";
      } else if (1 - rate > 1 - release.canary.requiredSuccessRate) {
        release.status = "evaluation_failed";
      }
    }
    release.updatedAt = new Date().toISOString();
    await this.save();
    return structuredClone(release);
  }

  async rollback(id: string): Promise<LearningRelease> {
    await this.load();
    const release = this.require(id);
    if (release.status !== "promoted") throw new Error("Only promoted releases can be rolled back.");
    await this.governor.rollback(release.candidateId);
    release.status = "rolled_back";
    release.updatedAt = new Date().toISOString();
    await this.save();
    return structuredClone(release);
  }

  private require(id: string): LearningRelease {
    const release = this.releases.find((item) => item.id === id);
    if (!release) throw new Error(`Learning release ${id} not found.`);
    return release;
  }
}

function publicKey(value: string) {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(value, "hex")]),
      format: "der",
      type: "spki",
    });
  }
  return createPublicKey(value);
}
