import type { ReactNode } from "react";
import type { GlyphName, TileColour } from "../glyphs";
import { Tile } from "./registry";

/** The prototype's empty screens: the app's tile, a title, a line, and what to do. */
export function EmptyState({
  glyph,
  colour,
  title,
  children,
  action,
}: {
  glyph: GlyphName;
  colour: TileColour;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ap-blank">
      <Tile glyph={glyph} colour={colour} size={52} />
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
