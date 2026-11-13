"use client";

import type { GlyphName, TileColour } from "../glyphs";
import { useAppWindow } from "./app-window";
import { Tile } from "./registry";
import { templates } from "./templates";

/** Each template's tile: a document or a sheet, in the prototype's colours. */
const COLOURS: readonly TileColour[] = [
  "blue",
  "purple",
  "pink",
  "orange",
  "teal",
  "indigo",
  "green",
  "red",
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
            const glyph: GlyphName =
              entry.app === "writer" ? "doc" : entry.app === "slides" ? "play" : "table";
            const colour = COLOURS[index % COLOURS.length] ?? "blue";
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
                    <span>
                      {entry.app === "writer"
                        ? "Document"
                        : entry.app === "slides"
                          ? "Presentation"
                          : "Spreadsheet"}
                    </span>
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
