import { apiErrorSchema } from "@brawzer/contracts";
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiException, rateLimited } from "./api-exception.js";
import { toApiError } from "./api-exception.filter.js";

describe("toApiError", () => {
  it("turns schema validation failures into validation_failed with details", () => {
    const result = toApiError(
      new BadRequestException(["email: Invalid email address", "password: Too short"]),
      "req-1",
    );
    expect(result).toEqual({
      status: 400,
      body: {
        error: {
          code: "validation_failed",
          message: "Some of the submitted values are invalid.",
          details: ["email: Invalid email address", "password: Too short"],
          requestId: "req-1",
        },
      },
    });
  });

  it("keeps messages that Brawzer code wrote for 4xx errors", () => {
    const result = toApiError(new ForbiddenException("This profile belongs to another account."));
    expect(result.status).toBe(403);
    expect(result.body.error).toEqual({
      code: "forbidden",
      message: "This profile belongs to another account.",
    });
  });

  it("replaces Nest's route-not-found text with a friendly message", () => {
    const result = toApiError(new NotFoundException("Cannot GET /api/v1/nope"));
    expect(result.body.error.message).toBe("We couldn't find what you were looking for.");
  });

  it("never exposes the cause of a server error", () => {
    const result = toApiError(
      new InternalServerErrorException('relation "users" does not exist at /srv/app/db.ts:42'),
    );
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("relation");
    expect(result.body.error.code).toBe("internal_error");
  });

  it("maps 503 to service_unavailable", () => {
    expect(toApiError(new ServiceUnavailableException()).body.error.code).toBe(
      "service_unavailable",
    );
  });

  it("treats unknown throwables as internal errors without leaking their message", () => {
    const result = toApiError(new Error("ECONNREFUSED 10.0.0.12:5432"));
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("10.0.0.12");
  });

  it("maps Fastify client errors by status code", () => {
    const tooLarge = Object.assign(new Error("Request body is too large"), { statusCode: 413 });
    expect(toApiError(tooLarge).body.error.code).toBe("payload_too_large");
  });

  it("keeps the code, message and details of an ApiException", () => {
    const result = toApiError(
      new ApiException("validation_failed", 400, "Choose a stronger password.", {
        details: ["password: That password is too common."],
      }),
      "req-2",
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toEqual({
      code: "validation_failed",
      message: "Choose a stronger password.",
      details: ["password: That password is too common."],
      requestId: "req-2",
    });
  });

  it("passes response headers through, such as Retry-After", () => {
    const result = toApiError(rateLimited(61));
    expect(result.status).toBe(429);
    expect(result.headers).toEqual({ "Retry-After": "61" });
    expect(result.body.error.message).toBe("Too many attempts. Try again in 2 minutes.");
  });

  it("still hides details of an ApiException with a 5xx status", () => {
    const result = toApiError(
      new ApiException("internal_error", 500, "pool exhausted at 10.0.0.3"),
    );
    expect(JSON.stringify(result.body)).not.toContain("10.0.0.3");
  });

  it("always produces a body that matches the shared contract", () => {
    for (const exception of [new BadRequestException(["x"]), new Error("boom"), "string thrown"]) {
      expect(apiErrorSchema.safeParse(toApiError(exception, "id").body).success).toBe(true);
    }
  });
});
