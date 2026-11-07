"use client";

import { useEffect, useSyncExternalStore } from "react";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Kept in memory only (never in storage) after it is removed from the address bar. */
let remembered: string | null = null;

function tokenInHash(): string | null {
  const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
  return value !== null && TOKEN_PATTERN.test(value) ? value : null;
}

function getSnapshot(): string | null {
  const token = tokenInHash();
  if (token) remembered = token;
  return token ?? remembered;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}

/**
 * The token from an emailed link (`/verify-email#token=…`). Tokens travel in
 * the URL fragment, which browsers never send to servers, so they don't end
 * up in logs. Once read, the token is removed from the address bar, which
 * keeps it out of view and out of the history of a shared computer.
 *
 * Returns undefined until the page is running in the browser, and null when
 * the page was opened without a usable link.
 */
export function useLinkToken(): string | null | undefined {
  const token = useSyncExternalStore(subscribe, getSnapshot, () => undefined);
  useEffect(() => {
    if (window.location.hash.length > 0) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, []);
  return token;
}

/** Call once a link has been used, so a later visit can't reuse it from memory. */
export function forgetLinkToken(): void {
  remembered = null;
}
