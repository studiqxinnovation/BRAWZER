import { cn } from "@brawzer/ui/lib/cn";
import type { CSSProperties } from "react";
import { type GlyphName, glyphs, type TileColour, tileColours } from "@/components/desktop/glyphs";

/** One of the prototype's stroke symbols, inheriting the text colour. */
export function GlyphSvg({
  glyph,
  className,
  style,
}: {
  glyph: GlyphName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      style={{
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2.2,
        ...style,
      }}
      // Static markup from glyphs.ts, never from data.
      dangerouslySetInnerHTML={{ __html: glyphs[glyph] }}
    />
  );
}

/** The prototype's Apple-style icon tile: a symbol on a glossy coloured square. */
export function GlyphTile({
  glyph,
  colour,
  size = 20,
  className,
  style,
}: {
  glyph: GlyphName;
  colour: TileColour;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const hex = tileColours[colour];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center align-middle text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: "23%",
        background: `linear-gradient(180deg, color-mix(in srgb, ${hex} 75%, #fff), ${hex})`,
        boxShadow: "inset 0 0.5px 0 rgb(255 255 255 / 0.35), 0 1px 2px rgb(0 0 0 / 0.22)",
        ...style,
      }}
    >
      <GlyphSvg glyph={glyph} style={{ width: "58%", height: "58%" }} />
    </span>
  );
}
