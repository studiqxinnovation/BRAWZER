"use client";

import type { DriveFile } from "@brawzer/contracts";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import { Tile } from "./apps/registry";
import type { GlyphName, TileColour } from "./glyphs";

/** A Drive file's tile, by kind, as the prototype draws files. */
export function fileTile(
  name: string,
  contentType: string,
): { glyph: GlyphName; colour: TileColour } {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (contentType === "application/pdf") return { glyph: "file", colour: "red" };
  if (contentType.startsWith("image/")) return { glyph: "image", colour: "teal" };
  if (contentType.startsWith("audio/")) return { glyph: "music", colour: "pink" };
  if (extension === "csv") return { glyph: "table", colour: "green" };
  if (extension === "html" || extension === "htm") return { glyph: "doc", colour: "blue" };
  if (contentType === "text/plain") return { glyph: "doc", colour: "gray" };
  return { glyph: "archive", colour: "brown" };
}

interface Icon {
  key: string;
  name: string;
  open: () => void;
  menu?: (event: MouseEvent<HTMLElement>) => void;
  file?: DriveFile;
  glyph: GlyphName;
  colour: TileColour;
}

/**
 * The desktop's icons, as on the prototype: Brawzer Drive (and the Recycle
 * Bin in Windows style), then whatever is in Drive's "Desktop" folder.
 * A column from the right (Mac) or left (Windows); click selects,
 * double-click or Enter opens, right-click shows its menu.
 */
export function DesktopIcons({
  style,
  files,
  onOpenDrive,
  onOpenTrash,
  onOpenFile,
  onFileMenu,
  onIconMenu,
}: {
  style: "mac" | "windows";
  files: readonly DriveFile[];
  onOpenDrive: () => void;
  onOpenTrash: () => void;
  onOpenFile: (file: DriveFile) => void;
  onFileMenu: (event: MouseEvent<HTMLElement>, file: DriveFile) => void;
  onIconMenu: (event: MouseEvent<HTMLElement>, open: () => void) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const icons: Icon[] = [
    { key: "drive", name: "Brawzer Drive", open: onOpenDrive, glyph: "drive", colour: "gray" },
    ...(style === "windows"
      ? [
          {
            key: "trash",
            name: "Recycle Bin",
            open: onOpenTrash,
            glyph: "trash" as const,
            colour: "gray" as const,
          },
        ]
      : []),
    ...files.map((file) => ({
      key: file.id,
      name: file.name,
      file,
      open: () => {
        onOpenFile(file);
      },
      ...fileTile(file.name, file.contentType),
    })),
  ];
  return (
    <ul className="dt-icons" data-style={style} aria-label="Desktop">
      {icons.map((icon) => (
        <li key={icon.key}>
          <button
            type="button"
            className="dt-dico"
            aria-pressed={selected === icon.key}
            onClick={() => {
              setSelected(icon.key);
            }}
            onDoubleClick={icon.open}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
              if (event.key === "Enter") icon.open();
            }}
            onContextMenu={(event) => {
              setSelected(icon.key);
              if (icon.file) onFileMenu(event, icon.file);
              else onIconMenu(event, icon.open);
            }}
            onBlur={() => {
              setSelected((current) => (current === icon.key ? null : current));
            }}
          >
            <span className="dt-dico-i">
              {icon.file?.previewable && icon.file.contentType.startsWith("image/") ? (
                // A Drive preview: same origin, served so it can't run.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/v1/drive/files/${icon.file.id}/preview`} alt="" />
              ) : (
                <Tile glyph={icon.glyph} colour={icon.colour} size={52} />
              )}
            </span>
            <span className="dt-dico-n">{icon.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
