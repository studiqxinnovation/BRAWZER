import { activeConcept, conceptSvgMarkup } from "@brawzer/ui/brand";

/**
 * The favicon, generated from the active brand concept so it can never drift
 * from the logo. Rendered once at build time.
 */
export function GET(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14.4" fill="#1c1b19"/><g transform="translate(8 8) scale(1.5)">${conceptSvgMarkup(activeConcept, "#f8f7f4")}</g></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
