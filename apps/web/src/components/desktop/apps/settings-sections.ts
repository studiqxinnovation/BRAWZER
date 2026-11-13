import type { GlyphName, TileColour } from "../glyphs";

/** Settings' sections, as its sidebar lists them and Search finds them. */
export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance", glyph: "sun", colour: "blue" },
  { id: "desktop", label: "Desktop and dock", glyph: "grid", colour: "indigo" },
  { id: "browsers", label: "Browsers", glyph: "globe", colour: "teal" },
  { id: "security", label: "Privacy and security", glyph: "lock", colour: "red" },
  { id: "storage", label: "Storage", glyph: "drive", colour: "gray" },
  { id: "about", label: "About Brawzer", glyph: "bag", colour: "orange" },
] as const satisfies readonly { id: string; label: string; glyph: GlyphName; colour: TileColour }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
