import { randomUUID } from "node:crypto";
import type { AgentMessage, ModelProvider, ModelRequest, ModelStreamEvent, ToolCallContent } from "../types.js";
import { modelHttpError } from "./model-provider-error.js";
import { resolveWorkspaceImage } from "./multimodal.js";

export interface OpenAICompatibleOptions {
  id?: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
}

function toContent(message: AgentMessage): string {
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "tool_result") return JSON.stringify(part.result);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function userContent(message: AgentMessage, workspacePath?: string): Promise<string | any[]> {
  const images = message.content.filter((part) => part.type === "image");
  if (!images.length) return toContent(message);
  const content: any[] = [];
  const text = toContent(message);
  if (text) content.push({ type: "text", text });
  for (const part of images) {
    if (part.type !== "image") continue;
    const image = await resolveWorkspaceImage(part, workspacePath);
    content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } });
  }
  return content;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  constructor(private readonly options: OpenAICompatibleOptions) {
    this.id = options.id ?? "openai-compatible";
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const messages: any[] = [{ role: "system", content: request.systemPrompt }];
    for (const message of request.messages) {
      if (message.role === "system") continue;
      if (message.role === "tool") {
        const result = message.content.find((part) => part.type === "tool_result");
        if (result?.type === "tool_result") {
          messages.push({ role: "tool", tool_call_id: result.toolCallId, content: JSON.stringify(result.result) });
        }
      } else if (message.role === "assistant") {
        const calls = message.content.filter((part) => part.type === "tool_call");
        messages.push({
          role: "assistant",
          content: toContent(message) || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((call) => ({
                  id: call.type === "tool_call" ? call.id : randomUUID(),
                  type: "function",
                  function: {
                    name: call.type === "tool_call" ? call.name.replaceAll(".", "__") : "unknown",
                    arguments: JSON.stringify(call.type === "tool_call" ? call.arguments : {}),
                  },
                })),
              }
            : {}),
        });
      } else {
        messages.push({ role: message.role, content: await userContent(message, request.workspacePath) });
      }
    }

    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: request.model?.includes(":") ? request.model.slice(request.model.indexOf(":") + 1) : this.options.model,
        messages,
        stream: false,
        tools: request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.id.replaceAll(".", "__"), description: `${tool.description} [capability-id: ${tool.id}]`, parameters: tool.inputSchema },
        })),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) throw await modelHttpError(this.id, response);
    const body: any = await response.json();
    const choice = body.choices?.[0];
    const message = choice?.message ?? {};
    if (typeof message.content === "string" && message.content) yield { type: "text_delta", delta: message.content };
    for (const item of message.tool_calls ?? []) {
      let args = {};
      try {
        args = JSON.parse(item.function?.arguments ?? "{}");
      } catch {
        args = { raw: item.function?.arguments ?? "" };
      }
      const call: ToolCallContent = {
        type: "tool_call",
        id: item.id ?? randomUUID(),
        name: (item.function?.name ?? "unknown").replaceAll("__", "."),
        arguments: args,
      };
      yield { type: "tool_call", call };
    }
    const usage = body.usage ?? {};
    yield {
      type: "usage",
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
    };
    yield { type: "done", stopReason: message.tool_calls?.length ? "tool_use" : choice?.finish_reason === "length" ? "max_tokens" : "end_turn" };
  }
}
