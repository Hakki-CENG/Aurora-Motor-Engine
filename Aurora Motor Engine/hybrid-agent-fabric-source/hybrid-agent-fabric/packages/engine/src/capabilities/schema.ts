import type { ZodTypeAny } from "zod";
import { z } from "zod";
import type { Capability, CapabilityContext, CapabilityDescriptor, JsonValue } from "../types.js";
import { asJsonValue } from "../util/json.js";

export function zodToSimpleJsonSchema(schema: ZodTypeAny): JsonValue {
  const shape = schema instanceof z.ZodObject ? schema.shape : {};
  const properties: Record<string, JsonValue> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    let current = value as ZodTypeAny;
    const optional = current.isOptional();
    if (optional) {
      const inner = (current as ZodTypeAny & { _def?: { innerType?: ZodTypeAny } })._def?.innerType;
      if (inner) current = inner;
    }
    let type = "string";
    if (current instanceof z.ZodNumber) type = "number";
    else if (current instanceof z.ZodBoolean) type = "boolean";
    else if (current instanceof z.ZodArray) type = "array";
    else if (current instanceof z.ZodObject) type = "object";
    properties[key] = { type };
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function defineCapability<TSchema extends z.ZodObject<z.ZodRawShape>>(
  descriptor: Omit<CapabilityDescriptor, "inputSchema">,
  schema: TSchema,
  execute: (input: z.infer<TSchema>, context: CapabilityContext) => Promise<unknown>,
): Capability {
  return {
    descriptor: { ...descriptor, inputSchema: zodToSimpleJsonSchema(schema) },
    validate(input: unknown) {
      return schema.parse(input) as Record<string, JsonValue>;
    },
    async execute(input, context) {
      return asJsonValue(await execute(input as z.infer<TSchema>, context));
    },
  };
}
