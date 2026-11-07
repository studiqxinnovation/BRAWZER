import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

/** What Brawzer records about a request for security purposes, and nothing more. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(request: Pick<FastifyRequest, "ip" | "headers">): RequestMeta {
  const userAgent = request.headers["user-agent"];
  return {
    // Only a real address is kept: with a trusted proxy the value comes from a header.
    ip: isIP(request.ip) === 0 ? null : request.ip,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 512) : null,
  };
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/**
 * True when a state-changing request demonstrably comes from one of Brawzer's
 * own pages. Together with SameSite cookies this blocks cross-site request
 * forgery: other sites cannot make the browser send a matching Origin.
 */
export function isAllowedOrigin(
  headers: IncomingHttpHeaders,
  allowedOrigins: readonly string[],
): boolean {
  const origin = headers.origin;
  if (typeof origin === "string") return allowedOrigins.includes(origin);
  // A browser that omits Origin still labels same-origin requests via Fetch Metadata.
  return headers["sec-fetch-site"] === "same-origin";
}
