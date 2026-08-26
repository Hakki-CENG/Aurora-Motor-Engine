import { z } from "zod";

export type UUID = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type InputSource =
  | "web"
  | "cli"
  | "api"
  | "scheduler"
  | "agent"
  | "telegram"
  | "discord"
  | "slack"
  | "webhook";

export type SessionStatus =
  | "provisioning"
  | "ready"
  | "running"
  | "idle"
  | "waiting_approval"
  | "waiting_children"
  | "compacting"
  | "paused"
  | "recovering"
  | "failed"
  | "closed";

export type CommandKind =
  | "session.prompt"
  | "artifact.interaction"
  | "session.cancel"
  | "session.pause"
  | "session.resume"
  | "session.close"
  | "session.compact"
  | "session.tree.get"
  | "session.tree.branch"
  | "session.tree.label"
  | "goal.set"
  | "goal.pause"
  | "goal.resume"
  | "goal.complete"
  | "goal.clear"
  | "autonomous.configure"
  | "model.select"
  | "agent.message"
  | "task.list"
  | "task.create"
  | "task.update";

export interface CommandEnvelope<TPayload extends JsonValue = JsonValue> {
  protocolVersion: 1;
  commandId: UUID;
  clientId: string;
  tenantId: string;
  sessionId: UUID;
  expectedGeneration?: number;
  kind: CommandKind;
  source: InputSource;
  issuedAt: string;
  payload: TPayload;
}

export interface CommandResult {
  commandId: UUID;
  status: "completed" | "rejected" | "uncertain";
  result?: JsonValue;
  error?: { code: string; message: string; retryable: boolean };
}

export type EventVisibility = "internal" | "user" | "audit";
export type RedactionClass =
  | "none"
  | "metadata-only"
  | "user-content"
  | "model-content"
  | "tool-arguments-sanitized"
  | "tool-result-sanitized";

export interface EventEnvelope<TPayload extends JsonValue = JsonValue> {
  schemaVersion: 1;
  eventId: UUID;
  tenantId: string;
  sessionId: UUID;
  familyId: UUID;
  generation: number;
  sequence: number;
  turnId?: UUID;
  traceId: UUID;
  type: string;
  timestamp: string;
  visibility: EventVisibility;
  redactionClass: RedactionClass;
  payload: TPayload;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  path: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  sha256?: string;
  alt?: string;
}

export interface ToolCallContent {
  type: "tool_call";
  id: UUID;
  name: string;
  arguments: Record<string, JsonValue>;
}

export interface ToolResultContent {
  type: "tool_result";
  toolCallId: UUID;
  name: string;
  result: JsonValue;
  isError: boolean;
}

export type MessageContent = TextContent | ImageContent | ToolCallContent | ToolResultContent;

export interface AgentMessage {
  id: UUID;
  role: "system" | "user" | "assistant" | "tool";
  content: MessageContent[];
  timestamp: string;
  source?: InputSource;
  usage?: ModelUsage;
  /** Internal model-context message omitted from public session/event/export surfaces. */
  hidden?: boolean;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;
}

/**
 * Prompt-cache marker hints for providers that support explicit breakpoints
 * (Anthropic and compatible APIs). Providers with automatic caching ignore it.
 * `scopeId` identifies the conversation's cache scope: Aurora compacts in
 * place, so the physical session id is the scope, and fork/delegate children
 * own their own id and therefore their own isolated scope.
 */
export interface PromptCacheHint {
  planId: string;
  scopeId: string;
  ttlMs: number;
  systemBreakpoint: boolean;
  toolBreakpoint: boolean;
  messageTailMarkers: number;
}

export interface ModelRequest {
  tenantId?: string;
  sessionId: UUID;
  turnId: UUID;
  model?: string;
  systemPrompt: string;
  messages: AgentMessage[];
  workspacePath?: string;
  tools: CapabilityDescriptor[];
  /** Explicit, ordered provider:model routes. They are never inferred across data-policy boundaries. */
  fallbackModels?: string[];
  /** Requested reasoning effort. Providers that do not support it ignore it; none may be broken by it. */
  reasoningEffort?: "low" | "medium" | "high" | "max";
  /** Explicit prompt-cache breakpoints computed by the prompt-cache planner. */
  promptCache?: PromptCacheHint;
  signal?: AbortSignal;
}

export type ModelStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_call"; call: ToolCallContent }
  | { type: "usage"; usage: ModelUsage }
  | { type: "route_selected"; provider: string; model: string; attempt: number; fallback: boolean }
  | { type: "route_failed"; provider: string; model: string; attempt: number; code: string; retryable: boolean }
  | { type: "done"; stopReason: "end_turn" | "tool_use" | "max_tokens" };

export interface ModelProvider {
  readonly id: string;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export type CapabilityRisk =
  | "pure"
  | "workspace_read"
  | "workspace_write"
  | "process"
  | "network"
  | "external_side_effect"
  | "privileged";

export interface CapabilityDescriptor {
  id: string;
  version: string;
  description: string;
  risk: CapabilityRisk;
  sideEffect: boolean;
  inputSchema: JsonValue;
  source: "core" | "skill" | "mcp" | "plugin";
}

export interface CapabilityContext {
  tenantId: string;
  sessionId: UUID;
  familyId: UUID;
  turnId: UUID;
  toolCallId: UUID;
  source: InputSource;
  workspacePath: string;
  allowedCapabilityIds?: string[];
  /** The agent profile this call runs under, so a hook can be scoped to one subagent. */
  agentProfileId?: string;
  signal?: AbortSignal;
  idempotencyKey: string;
}

export interface Capability {
  descriptor: CapabilityDescriptor;
  validate(input: unknown): Record<string, JsonValue>;
  execute(input: Record<string, JsonValue>, context: CapabilityContext): Promise<JsonValue>;
}

export interface PolicyDecision {
  decision: "allow" | "deny" | "require_approval";
  reasonCode: string;
  message: string;
  approvalScope?: "once" | "session" | "resource";
  constraints?: Record<string, JsonValue>;
}

export interface ApprovalRequest {
  id: UUID;
  tenantId: string;
  sessionId: UUID;
  turnId: UUID;
  toolCallId: UUID;
  capabilityId: string;
  risk: CapabilityRisk;
  argumentsPreview: JsonValue;
  reason: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied" | "expired";
  /** Present when a reviewed auto-approval rule answered instead of a human. */
  autoApproval?: { ruleId?: string; rationale: string };
  /** What the preview masked, shortened or dropped. An approver is told, never left to guess. */
  previewIntegrity?: {
    maskedValues: number;
    shortened: Array<{ key: string; originalChars: number; keptChars: number }>;
    droppedKeys: string[];
  };
}

export interface GoalState {
  objective: string;
  status: "active" | "paused" | "completed" | "failed";
  tokenBudget?: number;
  maxContinuations: number;
  tokensUsed: number;
  continuationCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AutonomousState {
  enabled: boolean;
  maxContinuations: number;
  maxTurns: number;
  maxTokens: number;
  timeoutMs: number;
  continuationPrompt: string;
  gates: string[];
  gateTimeoutMs: number;
  gateMaxRetries: number;
  continuationsUsed: number;
  turnsUsed: number;
  tokensUsed: number;
  startedAt?: string;
  gateAttempts: Record<string, number>;
  lastGateFingerprint?: string;
  lastGateFailure?: {
    command: string;
    exitCode: number | null;
    output: string;
  };
}

export interface SessionTreeEntry {
  id: UUID;
  parentId?: UUID;
  message: AgentMessage;
  labels: string[];
  contextReset?: boolean;
  createdAt: string;
}

export interface SessionTreeState {
  entries: SessionTreeEntry[];
  activeLeafId?: UUID;
}

export type AgentMessageDeliveryMode = "auto" | "steer" | "follow_up";
/** `external` is a same-tenant agent outside the sender's family: reachable by name, not by kinship. */
export type AgentMessageRelationship = "parent" | "sibling" | "child" | "external";
export type AgentInboxState = "pending" | "claimed" | "delivered" | "uncertain";

export interface AgentInboxMessage {
  id: UUID;
  commandId: UUID;
  tenantId: string;
  familyId: UUID;
  senderSessionId: UUID;
  senderName: string;
  targetSessionId: UUID;
  targetName: string;
  relationship: AgentMessageRelationship;
  requestedMode: AgentMessageDeliveryMode;
  effectiveMode: Exclude<AgentMessageDeliveryMode, "auto">;
  text: string;
  state: AgentInboxState;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  deliveredAt?: string;
  uncertainReason?: string;
}

export interface AgentMessageReceipt {
  id: UUID;
  targetSessionId: UUID;
  targetName: string;
  relationship: AgentMessageRelationship;
  requestedMode: AgentMessageDeliveryMode;
  effectiveMode: Exclude<AgentMessageDeliveryMode, "auto">;
  deliveryStatus: "delivered" | "queued";
  queuedAt: string;
  deliveredAt?: string;
}

export type TaskStatus = "backlog" | "ready" | "in_progress" | "blocked" | "review" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface TaskItem {
  id: UUID;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dependsOn: UUID[];
  assigneeSessionId?: UUID;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SessionAgentProfile {
  id: string;
  name: string;
  version: number;
  instructions: string;
  allowedCapabilityIds?: string[];
  modelRoute?: string;
  fallbackModels: string[];
}

export interface SessionSnapshot {
  sessionId: UUID;
  familyId: UUID;
  parentSessionId?: UUID;
  forkedFrom?: { sessionId: UUID; messageId?: UUID };
  tenantId: string;
  generation: number;
  lastSequence: number;
  status: SessionStatus;
  name: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
  tree?: SessionTreeState;
  childSessionIds: UUID[];
  activeTurnId?: UUID;
  modelName?: string;
  modelFallbacks?: string[];
  agentProfile?: SessionAgentProfile;
  tasks?: TaskItem[];
  goal?: GoalState;
  autonomous?: AutonomousState;
  totalUsage: ModelUsage;
}

export const commandEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  commandId: z.string().min(1),
  clientId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  expectedGeneration: z.number().int().nonnegative().optional(),
  kind: z.enum([
    "session.prompt",
    "artifact.interaction",
    "session.cancel",
    "session.pause",
    "session.resume",
    "session.close",
    "session.compact",
    "session.tree.get",
    "session.tree.branch",
    "session.tree.label",
    "goal.set",
    "goal.pause",
    "goal.resume",
    "goal.complete",
    "goal.clear",
    "autonomous.configure",
    "model.select",
    "agent.message",
    "task.list",
    "task.create",
    "task.update",
  ]),
  source: z.enum(["web", "cli", "api", "scheduler", "agent", "telegram", "discord", "slack", "webhook"]),
  issuedAt: z.string().datetime(),
  payload: z.unknown(),
});
