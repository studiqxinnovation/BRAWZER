import type { ApiErrorCode } from "@brawzer/contracts";
import { HttpException } from "@nestjs/common";

export interface ApiExceptionOptions {
  /** Field-level problems, formatted "field: message". */
  details?: readonly string[];
  /** Extra response headers, such as Retry-After. */
  headers?: Readonly<Record<string, string>>;
}

/**
 * An error with a stable machine-readable code and a message written for the
 * person using Brawzer. Never put internal details in the message.
 */
export class ApiException extends HttpException {
  readonly code: ApiErrorCode;
  readonly details: readonly string[] | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options: ApiExceptionOptions = {},
  ) {
    super(message, status);
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "a minute" : `${String(minutes)} minutes`;
}

export function rateLimited(retryAfterSeconds: number): ApiException {
  return new ApiException(
    "rate_limited",
    429,
    `Too many attempts. Try again in ${minutesLabel(retryAfterSeconds)}.`,
    { headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) } },
  );
}

/** 401 for a route that needs a session. `hadSession`: a cookie was sent but is no longer valid. */
export function signInRequired(hadSession = false): ApiException {
  return new ApiException(
    "unauthorized",
    401,
    hadSession ? "Your session has ended. Sign in to continue." : "Sign in to continue.",
  );
}
