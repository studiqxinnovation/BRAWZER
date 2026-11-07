const BASE = "https://brawzer.invalid";

/**
 * Where to go after signing in. Only paths on this site are accepted, so a
 * crafted link like /sign-in?next=https://evil.example can't send someone
 * elsewhere (an open redirect).
 */
export function safeNextPath(value: string | null | undefined, fallback = "/app"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    // Never bounce back into the sign-in flow itself.
    if (
      /^\/(?:sign-in|create-account|verify-email|forgot-password|reset-password)\b/.test(
        url.pathname,
      )
    ) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
