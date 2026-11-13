import { type NextRequest, NextResponse } from "next/server";
import { generateNonce, needsStrictCsp, strictContentSecurityPolicy } from "@/lib/csp";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

const development = process.env.NODE_ENV !== "production";
const https = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

function isSignedInArea(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

/**
 * Runs before account pages and the signed-in app render:
 * - visitors without a session cookie are sent to sign in (the page then asks
 *   the API whether a present cookie is actually valid);
 * - every response gets a fresh nonce and a strict script policy. Next.js
 *   reads the nonce from the request's policy and adds it to its own scripts.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isSignedInArea(pathname) && !SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = new URLSearchParams({ next: `${pathname}${search}` }).toString();
    return NextResponse.redirect(url);
  }

  if (!needsStrictCsp(pathname)) return NextResponse.next();

  const policy = strictContentSecurityPolicy(generateNonce(), { development, https });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    "/app",
    "/app/:path*",
    "/sign-in",
    "/create-account",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/confirm-email-change",
    "/undo-email-change",
  ],
};
