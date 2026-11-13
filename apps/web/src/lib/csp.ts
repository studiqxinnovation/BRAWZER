import { createHash, randomBytes } from "node:crypto";
import { themeBootstrapScript } from "./theme";

/**
 * Pages where passwords are typed or account data is shown. They are
 * rendered per request with a strict, nonce-based script policy. Other pages
 * are prerendered for speed, show no user data, and keep the site-wide policy
 * from next.config.ts (which still allows inline scripts).
 */
export const STRICT_CSP_PATHS = [
  "/app",
  "/sign-in",
  "/create-account",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/confirm-email-change",
  "/undo-email-change",
] as const;

export function needsStrictCsp(pathname: string): boolean {
  return STRICT_CSP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** The one inline script Brawzer writes itself (it sets the theme before first paint). */
const themeScriptHash = `'sha256-${createHash("sha256").update(themeBootstrapScript).digest("base64")}'`;

export function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Only scripts carrying this request's nonce (Next.js adds it to its own),
 * scripts they load ('strict-dynamic'), and the theme script by its hash may
 * run. An injected <script> runs nowhere.
 */
export function strictContentSecurityPolicy(
  nonce: string,
  options: { development: boolean; https: boolean; streamOrigin?: string },
): string {
  const stream = options.streamOrigin ? ` ${options.streamOrigin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${themeScriptHash}${options.development ? " 'unsafe-eval'" : ""}`,
    // Style attributes (used for positioning) can't carry nonces.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The cloud browser stream is a WebSocket on the API's public address.
    `connect-src 'self'${stream}${options.development ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    ...(options.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
