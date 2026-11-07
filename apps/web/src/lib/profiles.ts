import type { ProfileColor } from "@brawzer/contracts";

/** Each colour keeps a white initial at 4.5:1 contrast or better (see profiles.test.ts). */
export const profileColorShades: Record<ProfileColor, { label: string; hex: string }> = {
  indigo: { label: "Indigo", hex: "#4a5bd4" },
  teal: { label: "Teal", hex: "#237a6f" },
  copper: { label: "Copper", hex: "#a2552a" },
  violet: { label: "Violet", hex: "#7b45b8" },
  navy: { label: "Navy", hex: "#2b4a8b" },
  rose: { label: "Rose", hex: "#b03a5b" },
  green: { label: "Green", hex: "#4d7a2a" },
  slate: { label: "Slate", hex: "#55606e" },
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The first character of a name, as a person sees it (so an emoji or an
 * accented letter stays whole). `toUpperCase` rather than the locale-aware
 * version, so the server and the browser always agree.
 */
export function initialOf(name: string): string {
  const first = graphemes.segment(name.trim())[Symbol.iterator]().next();
  return first.done ? "?" : first.value.segment.toUpperCase();
}
