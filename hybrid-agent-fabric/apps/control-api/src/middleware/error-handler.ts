/**
 * Centralized Error Handler
 * Semantic error codes, structured error responses, and graceful error recovery.
 * Error code format: HAF-{CATEGORY}-{NUMBER}
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";

// ─── Error Code Registry ───

export const ErrorCodes = {
  // Auth errors (1xxx)
  AUTH_TOKEN_INVALID: { code: "HAF-1001", status: 401, message: "Invalid authentication token" },
  AUTH_TOKEN_EXPIRED: { code: "HAF-1002", status: 401, message: "Authentication token has expired" },
  AUTH_SESSION_NOT_FOUND: { code: "HAF-1003", status: 401, message: "Session not found or expired" },
  AUTH_SESSION_EXPIRED: { code: "HAF-1004", status: 401, message: "Session has expired" },
  AUTH_CSRF_INVALID: { code: "HAF-1005", status: 403, message: "CSRF token validation failed" },
  AUTH_INSUFFICIENT_ROLE: { code: "HAF-1006", status: 403, message: "Insufficient permissions for this operation" },
  AUTH_SYSTEM_ADMIN_REQUIRED: { code: "HAF-1007", status: 403, message: "System administrator access required" },
  AUTH_OIDC_ERROR: { code: "HAF-1008", status: 502, message: "OIDC authentication provider error" },
  AUTH_RATE_LIMITED: { code: "HAF-1009", status: 429, message: "Too many authentication attempts" },

  // Validation errors (2xxx)
  VALIDATION_BODY: { code: "HAF-2001", status: 400, message: "Request body validation failed" },
  VALIDATION_QUERY: { code: "HAF-2002", status: 400, message: "Query parameters validation failed" },
  VALIDATION_PARAMS: { code: "HAF-2003", status: 400, message: "Path parameters validation failed" },
  VALIDATION_HEADERS: { code: "HAF-2004", status: 400, message: "Request headers validation failed" },
  VALIDATION_FILE_TOO_LARGE: { code: "HAF-2005", status: 413, message: "File size exceeds maximum allowed" },
  VALIDATION_UNSUPPORTED_MEDIA: { code: "HAF-2006", status: 415, message: "Unsupported media type" },

  // Session errors (3xxx)
  SESSION_NOT_FOUND: { code: "HAF-3001", status: 404, message: "Session not found" },
  SESSION_ALREADY_CLOSED: { code: "HAF-3002", status: 409, message: "Session is already closed" },
  SESSION_LIMIT_EXCEEDED: { code: "HAF-3003", status: 429, message: "Maximum session limit reached" },
  SESSION_BUDGET_EXCEEDED: { code: "HAF-3004", status: 429, message: "Session token budget exceeded" },
  SESSION_EXECUTION_FAILED: { code: "HAF-3005", status: 500, message: "Session execution failed" },

  // Aurora errors (4xxx)
  AURORA_MEMORY_ERROR: { code: "HAF-4001", status: 500, message: "Memory operation failed" },
  AURORA_WORLD_MODEL_ERROR: { code: "HAF-4002", status: 500, message: "World model operation failed" },
  AURORA_INITIATIVE_ERROR: { code: "HAF-4003", status: 500, message: "Initiative engine error" },
  AURORA_EVOLUTION_ERROR: { code: "HAF-4004", status: 500, message: "Evolution service error" },
  AURORA_COGNITIVE_ERROR: { code: "HAF-4005", status: 500, message: "Cognitive orchestrator error" },
  AURORA_THOUGHT_ERROR: { code: "HAF-4006", status: 500, message: "Thought processing error" },
  AURORA_CONSTITUTION_VIOLATION: { code: "HAF-4007", status: 403, message: "Action violates constitution rules" },

  // Platform errors (5xxx)
  PLATFORM_NOT_FOUND: { code: "HAF-5001", status: 404, message: "Platform not found" },
  PLATFORM_WEBHOOK_INVALID: { code: "HAF-5002", status: 400, message: "Invalid webhook signature" },
  PLATFORM_CONNECTION_FAILED: { code: "HAF-5003", status: 502, message: "Platform connection failed" },
  PLATFORM_RATE_LIMITED: { code: "HAF-5004", status: 429, message: "Platform API rate limit exceeded" },
  PLATFORM_QUOTA_EXCEEDED: { code: "HAF-5005", status: 429, message: "Platform quota exceeded" },

  // Model errors (6xxx)
  MODEL_NOT_FOUND: { code: "HAF-6001", status: 404, message: "Model not found" },
  MODEL_PROVIDER_ERROR: { code: "HAF-6002", status: 502, message: "Model provider error" },
  MODEL_RATE_LIMITED: { code: "HAF-6003", status: 429, message: "Model rate limit exceeded" },
  MODEL_CONTEXT_TOO_LONG: { code: "HAF-6004", status: 400, message: "Context exceeds model limit" },
  MODEL_AUTH_ERROR: { code: "HAF-6005", status: 401, message: "Model authentication failed" },

  // Resource errors (7xxx)
  RESOURCE_NOT_FOUND: { code: "HAF-7001", status: 404, message: "Resource not found" },
  RESOURCE_CONFLICT: { code: "HAF-7002", status: 409, message: "Resource conflict" },
  RESOURCE_LOCKED: { code: "HAF-7003", status: 423, message: "Resource is locked" },
  RESOURCE_QUOTA_EXCEEDED: { code: "HAF-7004", status: 429, message: "Resource quota exceeded" },

  // System errors (8xxx)
  SYSTEM_INTERNAL: { code: "HAF-8001", status: 500, message: "Internal server error" },
  SYSTEM_SERVICE_UNAVAILABLE: { code: "HAF-8002", status: 503, message: "Service temporarily unavailable" },
  SYSTEM_TIMEOUT: { code: "HAF-8003", status: 504, message: "Request timeout" },
  SYSTEM_DEPENDENCY_FAILED: { code: "HAF-8004", status: 502, message: "External dependency failure" },
  SYSTEM_MAINTENANCE: { code: "HAF-8005", status: 503, message: "System under maintenance" },
} as const;

export type ErrorCodeKey = keyof typeof ErrorCodes;

// ─── Custom Error Classes ───

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(errorCode: ErrorCodeKey, details?: unknown, cause?: Error) {
    const def = ErrorCodes[errorCode];
    super(def.message);
    this.name = "AppError";
    this.code = def.code;
    this.status = def.status;
    this.details = details;
    this.isOperational = true;
    if (cause) this.cause = cause;
  }
}

export class ValidationError extends AppError {
  constructor(field: string, message: string, details?: Record<string, unknown>) {
    super("VALIDATION_BODY", { field, message, ...(details ?? {}) });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super("RESOURCE_NOT_FOUND", { resource, id });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(resource: string, message: string) {
    super("RESOURCE_CONFLICT", { resource, message });
    this.name = "ConflictError";
  }
}

// ─── Error Response Builder ───

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
    timestamp: string;
  };
}

function buildErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  requestId?: string
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
    },
  };
}

// ─── Error Handler Registration ───

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler(async (error: any, request, reply) => {
    const requestId = request.id;
    const timestamp = new Date().toISOString();

    // Log the error
    const logContext = {
      requestId,
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      timestamp,
    };

    // ZodError - validation failure
    if (error instanceof ZodError) {
      const fieldErrors = error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
        code: e.code,
      }));

      request.log.warn({ ...logContext, errors: fieldErrors }, "Validation error");

      return await reply.code(400).send(
        buildErrorResponse(
          "HAF-2001",
          "Request validation failed",
          { fields: fieldErrors },
          requestId
        )
      );
    }

    // AppError - known application error
    if (error instanceof AppError) {
      const logLevel = error.status >= 500 ? "error" : "warn";
      request.log[logLevel]({ ...logContext, errorCode: error.code, details: error.details }, error.message);

      return await reply.code(error.status).send(
        buildErrorResponse(error.code, error.message, error.details, requestId)
      );
    }

    // Fastify validation error
    if (error.validation) {
      request.log.warn({ ...logContext, validation: error.validation }, "Fastify validation error");

      return await reply.code(400).send(
        buildErrorResponse("HAF-2001", error.message, { validation: error.validation }, requestId)
      );
    }

    // SyntaxError (malformed JSON)
    if (error instanceof SyntaxError && "body" in error) {
      request.log.warn({ ...logContext }, "Malformed JSON in request body");

      return await reply.code(400).send(
        buildErrorResponse("HAF-2001", "Malformed JSON in request body", undefined, requestId)
      );
    }

    // Timeout
    if (error.message?.includes("timeout") || error.code === "ETIMEDOUT") {
      request.log.error({ ...logContext, error: error.message }, "Request timeout");

      return await reply.code(504).send(
        buildErrorResponse("HAF-8003", "Request timeout", undefined, requestId)
      );
    }

    // Unknown/unexpected error
    request.log.error({
      ...logContext,
      error: error.message,
      stack: error.stack,
      name: error.name,
    }, "Unhandled error");

    // Don't leak internal details in production
    const isDev = process.env.NODE_ENV !== "production";
    return await reply.code(500).send(
      buildErrorResponse(
        "HAF-8001",
        isDev ? error.message : "Internal server error",
        isDev ? { stack: error.stack } : undefined,
        requestId
      )
    );
  });

  // 404 handler
  app.setNotFoundHandler(async (request, reply) => {
    return await reply.code(404).send(
      buildErrorResponse(
        "HAF-7001",
        `Route ${request.method} ${request.url} not found`,
        { method: request.method, url: request.url },
        request.id
      )
    );
  });
}
