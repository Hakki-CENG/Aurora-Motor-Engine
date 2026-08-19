import type { JsonValue } from "../types.js";

export function asJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, asJsonValue(item)]));
  }
  return String(value);
}

export function safePreview(value: JsonValue, maxChars = 2000): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  return { truncated: true, preview: serialized.slice(0, maxChars), originalChars: serialized.length };
}
