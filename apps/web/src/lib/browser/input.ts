import type { ClientMessageInput, Viewport } from "@brawzer/contracts";
import { BROWSER_LIMITS } from "@brawzer/contracts";

/** DevTools modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

const BUTTONS = ["left", "middle", "right", "back", "forward"] as const;

export function buttonOf(button: number): (typeof BUTTONS)[number] | "none" {
  return BUTTONS[button] ?? "none";
}

/** The character a key press inserts, if it inserts one. */
export function textOf(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): string | undefined {
  if (event.ctrlKey || event.metaKey) return undefined;
  const { key } = event;
  // One character, possibly a surrogate pair; named keys ("Enter", "Dead") are longer.
  const printable = key.length === 1 || (key.length === 2 && /[\uD800-\uDBFF]/.test(key));
  return printable ? key : undefined;
}

/** Fits the available area into what the engine can stream (device pixel ratio 1, ADR 0006). */
export function fitViewport(width: number, height: number): Viewport {
  const { minWidth, minHeight, maxWidth, maxHeight } = BROWSER_LIMITS.viewport;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.floor(value)));
  return { width: clamp(width, minWidth, maxWidth), height: clamp(height, minHeight, maxHeight) };
}

/**
 * What to open for what someone typed in the address bar: an address when it
 * looks like one, otherwise a search. Searches go to DuckDuckGo, which keeps
 * no profile of the person.
 */
export function resolveTyped(input: string): string {
  const value = input.trim();
  if (value === "") return "about:blank";
  if (/^https?:\/\//i.test(value)) return value;
  // A scheme, unless the colon just introduces a port (localhost:3000).
  if (/^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))/i.test(value)) {
    // Another scheme (file:, javascript:, …): never opened; searched instead.
    return searchUrl(value);
  }
  const looksLikeHost =
    !/\s/.test(value) &&
    (/^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i.test(value) ||
      /^\[?[0-9a-f:.]+\]?(:\d+)?([/?#]|$)/i.test(value));
  return looksLikeHost ? `https://${value}` : searchUrl(value);
}

export function searchUrl(query: string): string {
  return `https://duckduckgo.com/?${new URLSearchParams({ q: query }).toString()}`;
}

/** The address as shown: no scheme for https, nothing for a blank tab. */
export function displayUrl(url: string): string {
  if (url === "about:blank" || url === "") return "";
  return url.replace(/^https:\/\//, "");
}

/** The host of a page, for the tab title fallback. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** A keyboard event as the engine wants it. */
export function keyMessage(
  tabId: string,
  kind: "down" | "up",
  event: {
    key: string;
    code: string;
    keyCode: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
): ClientMessageInput {
  const text = kind === "down" ? textOf(event) : undefined;
  return {
    type: "key",
    tabId,
    kind,
    key: event.key.slice(0, 32),
    code: event.code.slice(0, 32),
    keyCode: Math.min(255, Math.max(0, event.keyCode)),
    ...(text ? { text } : {}),
    modifiers: modifiersOf(event),
  };
}
