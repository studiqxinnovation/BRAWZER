import { sessionCookieName } from "@brawzer/contracts";

/**
 * The API names the cookie `__Host-brawzer_session` over HTTPS and
 * `brawzer_session` on plain-HTTP localhost. The web app accepts either; the
 * API decides whether a session is valid.
 */
export const SESSION_COOKIE_NAMES = [sessionCookieName(true), sessionCookieName(false)] as const;
