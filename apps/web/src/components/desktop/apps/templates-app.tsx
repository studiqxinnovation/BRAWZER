"use client";

import type { GlyphName, TileColour } from "../glyphs";
import { useAppWindow } from "./app-window";
import { Tile } from "./registry";
import { templates } from "./templates";

/** Each template's tile, as the prototype colours them. */
const TILES: readonly (readonly [GlyphName, TileColour])[] = [
  ["doc", "blue"],
  ["grid", "purple"],
  ["table", "green"],
  ["table", "pink"],
  ["note", "yellow"],
  ["clock", "teal"],
  ["pen", "orange"],
  ["table", "blue"],
  ["doc", "indigo"],
  ["table", "red"],
];

/**
 * Templates, as the prototype's: "Start from a template", each a card that
 * opens a new document in Writer or a new sheet in Calc.
 */
export default function TemplatesApp() {
  const window = useAppWindow();
  return (
    <div className="ap-body">
      <div className="ap-tp-main">
        <h2 className="ap-tp-h">Start from a template</h2>
        <p className="ap-tp-sub">
          Each one makes a new file you can edit, then save to your Drive.
        </p>
        <ul className="ap-tp-grid" aria-label="Templates">
          {templates.map((entry, index) => {
            const [glyph, colour] = TILES[index % TILES.length] ?? ["doc", "blue"];
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="ap-tp-card"
                  title={entry.description}
                  onClick={() => {
                    window.openApp(entry.app, { template: entry.id });
                  }}
                >
                  <Tile glyph={glyph} colour={colour} size={38} />
                  <span>
                    <b>{entry.name}</b>
                    <span>{entry.app === "writer" ? "Document" : "Spreadsheet"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
