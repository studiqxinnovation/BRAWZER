import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

/**
 * Sends visitors without a session cookie to sign in before any signed-in
 * page renders. Only presence is checked here; the page asks the API whether
 * the session is actually valid.
 */
export function proxy(request: NextRequest) {
  if (SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = new URLSearchParams({
    next: `${request.nextUrl.pathname}${request.nextUrl.search}`,
  }).toString();
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
