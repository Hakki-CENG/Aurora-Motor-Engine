/**
 * Error Handler Tests
 */

import { describe, it, expect } from "vitest";
import { ErrorCodes, AppError, ValidationError, NotFoundError, ConflictError } from "../src/middleware/error-handler.js";

describe("Error Codes", () => {
  it("should have auth error codes", () => {
    expect(ErrorCodes.AUTH_TOKEN_INVALID.code).toBe("HAF-1001");
    expect(ErrorCodes.AUTH_TOKEN_INVALID.status).toBe(401);
    expect(ErrorCodes.AUTH_TOKEN_EXPIRED.code).toBe("HAF-1002");
    expect(ErrorCodes.AUTH_CSRF_INVALID.code).toBe("HAF-1005");
    expect(ErrorCodes.AUTH_RATE_LIMITED.code).toBe("HAF-1009");
  });

  it("should have validation error codes", () => {
    expect(ErrorCodes.VALIDATION_BODY.code).toBe("HAF-2001");
    expect(ErrorCodes.VALIDATION_BODY.status).toBe(400);
    expect(ErrorCodes.VALIDATION_FILE_TOO_LARGE.code).toBe("HAF-2005");
    expect(ErrorCodes.VALIDATION_FILE_TOO_LARGE.status).toBe(413);
  });

  it("should have session error codes", () => {
    expect(ErrorCodes.SESSION_NOT_FOUND.code).toBe("HAF-3001");
    expect(ErrorCodes.SESSION_NOT_FOUND.status).toBe(404);
    expect(ErrorCodes.SESSION_BUDGET_EXCEEDED.code).toBe("HAF-3004");
    expect(ErrorCodes.SESSION_BUDGET_EXCEEDED.status).toBe(429);
  });

  it("should have aurora error codes", () => {
    expect(ErrorCodes.AURORA_MEMORY_ERROR.code).toBe("HAF-4001");
    expect(ErrorCodes.AURORA_WORLD_MODEL_ERROR.code).toBe("HAF-4002");
    expect(ErrorCodes.AURORA_CONSTITUTION_VIOLATION.code).toBe("HAF-4007");
    expect(ErrorCodes.AURORA_CONSTITUTION_VIOLATION.status).toBe(403);
  });

  it("should have platform error codes", () => {
    expect(ErrorCodes.PLATFORM_NOT_FOUND.code).toBe("HAF-5001");
    expect(ErrorCodes.PLATFORM_WEBHOOK_INVALID.code).toBe("HAF-5002");
  });

  it("should have model error codes", () => {
    expect(ErrorCodes.MODEL_NOT_FOUND.code).toBe("HAF-6001");
    expect(ErrorCodes.MODEL_RATE_LIMITED.code).toBe("HAF-6003");
    expect(ErrorCodes.MODEL_CONTEXT_TOO_LONG.code).toBe("HAF-6004");
    expect(ErrorCodes.MODEL_CONTEXT_TOO_LONG.status).toBe(400);
  });

  it("should have resource error codes", () => {
    expect(ErrorCodes.RESOURCE_NOT_FOUND.code).toBe("HAF-7001");
    expect(ErrorCodes.RESOURCE_CONFLICT.code).toBe("HAF-7002");
    expect(ErrorCodes.RESOURCE_LOCKED.code).toBe("HAF-7003");
    expect(ErrorCodes.RESOURCE_LOCKED.status).toBe(423);
  });

  it("should have system error codes", () => {
    expect(ErrorCodes.SYSTEM_INTERNAL.code).toBe("HAF-8001");
    expect(ErrorCodes.SYSTEM_INTERNAL.status).toBe(500);
    expect(ErrorCodes.SYSTEM_SERVICE_UNAVAILABLE.code).toBe("HAF-8002");
    expect(ErrorCodes.SYSTEM_TIMEOUT.code).toBe("HAF-8003");
  });
});

describe("AppError", () => {
  it("should create error with correct properties", () => {
    const error = new AppError("AUTH_TOKEN_INVALID", { token: "abc" });
    expect(error.code).toBe("HAF-1001");
    expect(error.status).toBe(401);
    expect(error.message).toBe("Invalid authentication token");
    expect(error.details).toEqual({ token: "abc" });
    expect(error.isOperational).toBe(true);
  });

  it("should be instanceof Error", () => {
    const error = new AppError("SYSTEM_INTERNAL");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });
});

describe("ValidationError", () => {
  it("should create validation error", () => {
    const error = new ValidationError("email", "Invalid email format");
    expect(error.code).toBe("HAF-2001");
    expect(error.status).toBe(400);
    expect(error.details).toEqual({
      field: "email",
      message: "Invalid email format",
    });
  });
});

describe("NotFoundError", () => {
  it("should create not found error", () => {
    const error = new NotFoundError("Session", "abc-123");
    expect(error.code).toBe("HAF-7001");
    expect(error.status).toBe(404);
    expect(error.details).toEqual({
      resource: "Session",
      id: "abc-123",
    });
  });
});

describe("ConflictError", () => {
  it("should create conflict error", () => {
    const error = new ConflictError("Session", "Session already closed");
    expect(error.code).toBe("HAF-7002");
    expect(error.status).toBe(409);
    expect(error.details).toEqual({
      resource: "Session",
      message: "Session already closed",
    });
  });
});
