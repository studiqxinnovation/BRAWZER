/**
 * Brawzer logo concepts, drawn on a 32 × 32 grid. Strokes and gaps are whole
 * multiples of two units, so they land on full pixels at a 16 px favicon size.
 */

export type BrandConceptId = "stack" | "aperture" | "sweep";

export interface BrandConcept {
  id: BrandConceptId;
  name: string;
  summary: string;
  rationale: string;
  recommended?: boolean;
}

export const brandConcepts: readonly BrandConcept[] = [
  {
    id: "stack",
    name: "Stack",
    summary: "A browser tab resting on a window, forming a B.",
    rationale:
      "Reads both as a browser and as the letter B. Solid geometry holds its shape at favicon size and in a single colour.",
    recommended: true,
  },
  {
    id: "aperture",
    name: "Aperture",
    summary: "A lowercase b whose counter is a browser window.",
    rationale:
      "Softer and letter-led. The window inside the b says what Brawzer is without needing the wordmark.",
  },
  {
    id: "sweep",
    name: "Sweep",
    summary: "The z of Brawzer drawn as one stroke that ends in a dot.",
    rationale:
      "Gestural and distinctive: a single trace that stops cleanly, a quiet nod to leaving nothing behind.",
  },
];

/**
 * The concept used across the product until a final mark is chosen on
 * /design. Changing this one value updates the favicon, app icons and logo.
 */
export const activeConcept: BrandConceptId = "stack";

/** Two solid shapes: the tab (top) and the window (bottom). */
export const STACK_PATH =
  "M6 14V8a3 3 0 0 1 3-3h6.5A4.5 4.5 0 0 1 20 9.5V14zM6 17.5A1.5 1.5 0 0 1 7.5 16h13a5.5 5.5 0 0 1 0 11H9a3 3 0 0 1-3-3z";

/** Stem and bowl of the b; the second sub-path is the window-shaped counter (even-odd fill). */
export const APERTURE_PATH =
  "M7 6.5a2 2 0 0 1 4 0v5h8a6 6 0 0 1 6 6v4a6 6 0 0 1-6 6H7zM12.5 15.5H19a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-6.5a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 1.5-1.5z";

/** One stroke (4 units wide, round caps) plus the closing dot. */
export const SWEEP_PATH = "M8.5 9h15L8.5 23h8";
export const SWEEP_DOT = { cx: 22.5, cy: 23, r: 2 } as const;
export const SWEEP_STROKE_WIDTH = 4;

/** Standalone SVG markup for a concept (favicons, generated images). */
export function conceptSvgMarkup(concept: BrandConceptId, color: string): string {
  switch (concept) {
    case "stack":
      return `<path d="${STACK_PATH}" fill="${color}"/>`;
    case "aperture":
      return `<path d="${APERTURE_PATH}" fill="${color}" fill-rule="evenodd"/>`;
    case "sweep":
      return `<path d="${SWEEP_PATH}" fill="none" stroke="${color}" stroke-width="${String(SWEEP_STROKE_WIDTH)}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${String(SWEEP_DOT.cx)}" cy="${String(SWEEP_DOT.cy)}" r="${String(SWEEP_DOT.r)}" fill="${color}"/>`;
  }
}
