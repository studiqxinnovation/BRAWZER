import type { ApiError, ApiErrorCode } from "@brawzer/contracts";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { ApiException } from "./api-exception.js";

const codeByStatus: Partial<Record<number, ApiErrorCode>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
  503: "service_unavailable",
};

const defaultMessages: Record<ApiErrorCode, string> = {
  bad_request: "The request could not be processed.",
  validation_failed: "Some of the submitted values are invalid.",
  unauthorized: "You need to sign in to do that.",
  invalid_credentials: "Email or password is incorrect.",
  email_not_verified: "Confirm your email address first.",
  token_invalid: "This link has expired or has already been used.",
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find what you were looking for.",
  method_not_allowed: "That action isn't supported here.",
  conflict: "That conflicts with the current state. Refresh and try again.",
  payload_too_large: "The request is too large.",
  unsupported_media_type: "That content type isn't supported.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "The service is temporarily unavailable. Try again shortly.",
  internal_error: "Something went wrong on our side. Try again in a moment.",
};

export interface ResolvedApiError {
  status: number;
  body: ApiError;
  headers?: Readonly<Record<string, string>>;
}

function messageOf(response: unknown): unknown {
  if (typeof response === "string") return response;
  if (typeof response === "object" && response !== null && "message" in response) {
    return response.message;
  }
  return undefined;
}

/** Nest's built-in 404 says "Cannot GET /path"; replace it with a friendly message. */
const routeNotFound = /^Cannot (?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) /;

export function errorBody(
  code: ApiErrorCode,
  message: string,
  requestId: string | undefined,
  details?: readonly string[],
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details ? { details: [...details] } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
}

/**
 * Converts any thrown value into Brawzer's standard error envelope.
 *
 * Server errors (5xx) always get a generic message. Their real cause is
 * logged, never sent to the client.
 */
export function toApiError(exception: unknown, requestId?: string): ResolvedApiError {
  if (exception instanceof ApiException) {
    const status = exception.getStatus();
    if (status >= 500) {
      const code = status === 503 ? "service_unavailable" : "internal_error";
      return { status, body: errorBody(code, defaultMessages[code], requestId) };
    }
    return {
      status,
      body: errorBody(exception.code, exception.message, requestId, exception.details),
      headers: exception.headers,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) {
      const code = status === 503 ? "service_unavailable" : "internal_error";
      return { status, body: errorBody(code, defaultMessages[code], requestId) };
    }

    const message = messageOf(exception.getResponse());
    if (status === 400 && Array.isArray(message)) {
      const details = message.filter((item): item is string => typeof item === "string");
      return {
        status,
        body: errorBody("validation_failed", defaultMessages.validation_failed, requestId, details),
      };
    }

    const code = codeByStatus[status] ?? "bad_request";
    const text =
      typeof message === "string" && message.length > 0 && !routeNotFound.test(message)
        ? message
        : defaultMessages[code];
    return { status, body: errorBody(code, text, requestId) };
  }

  // Errors raised by Fastify itself (malformed JSON, oversized body, ...) carry a 4xx statusCode.
  const statusCode =
    typeof exception === "object" && exception !== null && "statusCode" in exception
      ? exception.statusCode
      : undefined;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    const code = codeByStatus[statusCode] ?? "bad_request";
    return { status: statusCode, body: errorBody(code, defaultMessages[code], requestId) };
  }

  return {
    status: 500,
    body: errorBody("internal_error", defaultMessages.internal_error, requestId),
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, body, headers } = toApiError(exception, request.id);

    if (status >= 500) {
      this.logger.error({ err: exception, requestId: request.id }, "Request failed");
    }
    void reply
      .status(status)
      .headers({ ...headers, "Cache-Control": "no-store" })
      .send(body);
  }
}
