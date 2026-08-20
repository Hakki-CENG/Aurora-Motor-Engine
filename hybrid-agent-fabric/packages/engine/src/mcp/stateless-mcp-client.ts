import { randomUUID } from "node:crypto";
import { auroraInteger, auroraText } from "../util/aurora-state.js";

export const MCP_STATELESS_REVISION = "2026-07-28";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_STATE_CHARS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_LIST_TTL_MS = 60_000;

export interface StatelessMcpOptions {
  endpoint: string;
  /** Refuse plain HTTP unless a deployment explicitly opts in (loopback development). */
  allowPlainHttp?: boolean;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  /** How long `server/discover` and list results may be reused. The revision makes them cacheable. */
  listCacheTtlMs?: number;
  clientInfo?: { name: string; version: string };
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface DiscoverResult {
  protocolVersion: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: Record<string, unknown>;
  instructions?: string;
  fromCache: boolean;
  fetchedAt: string;
}

export interface InputRequest {
  id: string;
  prompt: string;
  /** `choice` carries options; anything else is free text the caller must gather. */
  kind: "choice" | "text" | "confirmation";
  options?: Array<{ id: string; label: string }>;
}

export type ToolCallOutcome =
  | { status: "completed"; result: unknown }
  | { status: "input-required"; requestState: string; requestId: string; inputRequests: InputRequest[] }
  | { status: "error"; code: number; message: string };

/**
 * A client for the MCP 2026-07-28 stateless revision.
 *
 * The specification removed the `initialize` handshake and `Mcp-Session-Id` entirely: every request
 * now self-describes through `_meta` and routing headers, capabilities come from an optional
 * `server/discover`, list results are cacheable, and server-initiated requests (elicitation, sampling)
 * are replaced by **Multi Round-Trip Requests** — the server answers `input_required` with a
 * `requestState`, and the client re-issues the original call with the answers attached.
 *
 * The SDK-backed manager keeps speaking the handshake revision for existing servers; this client is
 * what lets Aurora talk to servers that migrated. Three properties matter more than protocol coverage:
 *
 * - **`requestState` is attacker-controlled input.** It round-trips through us from the server, so it
 *   is length-bounded, never parsed, never interpreted, and never allowed to influence authorization
 *   here — it is echoed back verbatim and nothing else.
 * - **Headers must agree with the body.** The revision requires `MCP-Protocol-Version`, `Mcp-Method`
 *   and (for named calls) `Mcp-Name`; we send them and refuse to construct a request whose header
 *   would disagree with its body, because that mismatch is exactly what gateway confusion attacks use.
 * - **Startup never blocks a turn.** `server/discover` is optional in the revision: a failure marks the
 *   server degraded and leaves tool calls to fail on their own terms, rather than hanging a session.
 */
export class StatelessMcpClient {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private discovered: { value: DiscoverResult; at: number } | undefined;
  private toolCache: { value: McpToolDescriptor[]; at: number } | undefined;

  constructor(private readonly options: StatelessMcpOptions) {
    const endpoint = new URL(auroraText(options.endpoint, 2000, "MCP endpoint"));
    if (endpoint.protocol !== "https:" && !options.allowPlainHttp) {
      throw new Error("Stateless MCP requires HTTPS unless plain HTTP is explicitly enabled.");
    }
    if (endpoint.username || endpoint.password) throw new Error("MCP endpoints must not embed credentials.");
    this.endpoint = endpoint;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** Optional in the revision, so a failure is reported, not thrown into the caller's turn. */
  async discover(force = false): Promise<DiscoverResult | { failed: true; reason: string }> {
    const ttl = auroraInteger(this.options.listCacheTtlMs ?? DEFAULT_LIST_TTL_MS, 0, 3_600_000, "List cache TTL");
    if (!force && this.discovered && this.now() - this.discovered.at < ttl) {
      return { ...this.discovered.value, fromCache: true };
    }
    try {
      const result = await this.rpc<{ protocolVersion?: string; serverInfo?: DiscoverResult["serverInfo"]; capabilities?: Record<string, unknown>; instructions?: string }>("server/discover", {});
      const value: DiscoverResult = {
        protocolVersion: result.protocolVersion ?? MCP_STATELESS_REVISION,
        ...(result.serverInfo ? { serverInfo: result.serverInfo } : {}),
        ...(result.capabilities ? { capabilities: result.capabilities } : {}),
        ...(result.instructions ? { instructions: result.instructions.slice(0, 10_000) } : {}),
        fromCache: false,
        fetchedAt: new Date(this.now()).toISOString(),
      };
      this.discovered = { value, at: this.now() };
      return value;
    } catch (error) {
      return { failed: true, reason: `${(error as Error).message}`.slice(0, 300) };
    }
  }

  /** Cacheable per the revision: list results no longer vary per connection. */
  async listTools(force = false): Promise<{ tools: McpToolDescriptor[]; fromCache: boolean }> {
    const ttl = auroraInteger(this.options.listCacheTtlMs ?? DEFAULT_LIST_TTL_MS, 0, 3_600_000, "List cache TTL");
    if (!force && this.toolCache && this.now() - this.toolCache.at < ttl) {
      return { tools: this.toolCache.value.map((item) => structuredClone(item)), fromCache: true };
    }
    const result = await this.rpc<{ tools?: McpToolDescriptor[] }>("tools/list", {});
    const tools = (result.tools ?? []).slice(0, 1000).map((tool) => ({
      name: auroraText(tool.name, 200, "Tool name"),
      ...(tool.description ? { description: String(tool.description).slice(0, 4000) } : {}),
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    }));
    this.toolCache = { value: tools, at: this.now() };
    return { tools: tools.map((item) => structuredClone(item)), fromCache: false };
  }

  /**
   * Call a tool. When the server needs something mid-call it answers `input_required`; gather the
   * answers and call again with `inputResponses`, the same `requestId` and the returned `requestState`.
   */
  async callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
    requestId?: string;
    requestState?: string;
    inputResponses?: Array<{ id: string; value: string }>;
  }): Promise<ToolCallOutcome> {
    const name = auroraText(input.name, 200, "Tool name");
    const requestId = input.requestId ?? randomUUID();
    if (input.requestState !== undefined && input.requestState.length > MAX_REQUEST_STATE_CHARS) {
      throw new Error("Server requestState exceeds the accepted bound.");
    }
    const params: Record<string, unknown> = {
      name,
      arguments: input.arguments ?? {},
      ...(input.requestState ? { requestState: input.requestState } : {}),
      ...(input.inputResponses?.length ? { inputResponses: input.inputResponses.slice(0, 20) } : {}),
    };

    try {
      const result = await this.rpc<Record<string, unknown>>("tools/call", params, { id: requestId, name });
      if (result && result["resultType"] === "input_required") {
        const requestState = String(result["requestState"] ?? "");
        if (!requestState || requestState.length > MAX_REQUEST_STATE_CHARS) {
          return { status: "error", code: -32600, message: "Server asked for input without a usable requestState." };
        }
        const requests = Array.isArray(result["inputRequests"]) ? result["inputRequests"] as Array<Record<string, unknown>> : [];
        return {
          status: "input-required",
          requestState,
          requestId,
          inputRequests: requests.slice(0, 10).map((item, index) => ({
            id: String(item["id"] ?? `input-${index + 1}`).slice(0, 100),
            prompt: String(item["prompt"] ?? item["message"] ?? "Input required").slice(0, 2000),
            kind: item["kind"] === "choice" || item["kind"] === "confirmation" ? item["kind"] as "choice" | "confirmation" : "text",
            ...(Array.isArray(item["options"])
              ? {
                options: (item["options"] as Array<Record<string, unknown>>).slice(0, 6).map((option, optionIndex) => ({
                  id: String(option["id"] ?? `option-${optionIndex + 1}`).slice(0, 100),
                  label: String(option["label"] ?? option["id"] ?? `option ${optionIndex + 1}`).slice(0, 200),
                })),
              }
              : {}),
          })),
        };
      }
      return { status: "completed", result };
    } catch (error) {
      return { status: "error", code: -32000, message: `${(error as Error).message}`.slice(0, 500) };
    }
  }

  /**
   * Drive a tool call to completion, delegating any mid-call input request to the caller. Bounded to a
   * few rounds so a server cannot keep a turn alive by asking forever.
   */
  async callToolInteractive(input: {
    name: string;
    arguments?: Record<string, unknown>;
    resolveInputs: (requests: InputRequest[]) => Promise<Array<{ id: string; value: string }>>;
    maxRounds?: number;
  }): Promise<ToolCallOutcome & { rounds: number }> {
    const maxRounds = auroraInteger(input.maxRounds ?? 3, 1, 10, "Input rounds");
    let outcome = await this.callTool({ name: input.name, ...(input.arguments ? { arguments: input.arguments } : {}) });
    let rounds = 1;
    while (outcome.status === "input-required" && rounds < maxRounds) {
      const answers = await input.resolveInputs(outcome.inputRequests);
      outcome = await this.callTool({
        name: input.name,
        ...(input.arguments ? { arguments: input.arguments } : {}),
        requestId: outcome.requestId,
        requestState: outcome.requestState,
        inputResponses: answers,
      });
      rounds++;
    }
    if (outcome.status === "input-required") {
      return { status: "error", code: -32001, message: `Server still requires input after ${rounds} round(s).`, rounds };
    }
    return { ...outcome, rounds };
  }

  private async rpc<T>(method: string, params: Record<string, unknown>, options: { id?: string; name?: string } = {}): Promise<T> {
    const id = options.id ?? randomUUID();
    const body = {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_STATELESS_REVISION,
          "io.modelcontextprotocol/clientInfo": this.options.clientInfo ?? { name: "hybrid-agent-fabric", version: "1.57.0" },
          "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {} } },
        },
      },
    };

    // Routing headers must mirror the body exactly; a mismatch is what gateway confusion exploits.
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": MCP_STATELESS_REVISION,
      "Mcp-Method": method,
      ...(this.options.headers ?? {}),
    };
    if (options.name) headers["Mcp-Name"] = options.name;
    if (headers["Mcp-Method"] !== method) throw new Error("Refusing to send an MCP request whose method header disagrees with its body.");
    if (options.name && headers["Mcp-Name"] !== options.name) throw new Error("Refusing to send an MCP request whose name header disagrees with its body.");
    // The revision removed sessions outright: we never send one, whatever a caller configured.
    delete headers["Mcp-Session-Id"];
    delete headers["mcp-session-id"];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), auroraInteger(this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS, 1000, 600_000, "MCP timeout"));
    timeout.unref?.();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("MCP redirects are refused.");
    if (!response.ok) throw new Error(`MCP request failed with HTTP ${response.status}.`);

    const text = await boundedText(response);
    let payload: { result?: T; error?: { code?: number; message?: string } };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new Error("MCP response was not valid JSON.");
    }
    if (payload.error) throw new Error(`MCP error ${payload.error.code ?? -32000}: ${String(payload.error.message ?? "unknown").slice(0, 300)}`);
    return (payload.result ?? {}) as T;
  }
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const decoder = new TextDecoder();
  let output = "";
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("MCP response exceeded its safety bound.");
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
