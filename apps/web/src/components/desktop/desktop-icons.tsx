"use client";

import { type DriveFile, OFFICE_TYPES } from "@brawzer/contracts";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  noIconPositions,
  readIconPositions,
  setIconPosition,
  subscribeToIconPositions,
} from "@/lib/icon-positions";
import { Tile } from "./apps/registry";
import { postToBrowserWindow } from "./desktop-context";
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
  if (extension === "csv" || contentType === OFFICE_TYPES.excel) {
    return { glyph: "table", colour: "green" };
  }
  if (extension === "slides" || contentType === OFFICE_TYPES.powerpoint) {
    return { glyph: "play", colour: "orange" };
  }
  if (extension === "html" || extension === "htm" || contentType === OFFICE_TYPES.word) {
    return { glyph: "doc", colour: "blue" };
  }
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
  onHoldFile,
}: {
  style: "mac" | "windows";
  files: readonly DriveFile[];
  onOpenDrive: () => void;
  onOpenTrash: () => void;
  onOpenFile: (file: DriveFile) => void;
  onFileMenu: (event: MouseEvent<HTMLElement>, file: DriveFile) => void;
  onIconMenu: (event: MouseEvent<HTMLElement>, open: () => void) => void;
  /** Cmd/Ctrl+X or C on a file: cut or copy it, to paste elsewhere. */
  onHoldFile: (file: DriveFile, mode: "cut" | "copy") => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const positions = useSyncExternalStore(
    subscribeToIconPositions,
    readIconPositions,
    noIconPositions,
  );
  const list = useRef<HTMLUListElement>(null);
  // Dragging an icon: where it started, and whether it moved far enough to count.
  const drag = useRef<{
    key: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  const [lifted, setLifted] = useState<{ key: string; x: number; y: number } | null>(null);
  const liftedRef = useRef<{ key: string; x: number; y: number } | null>(null);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, key: string) {
    if (event.button !== 0 || !list.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const area = list.current.getBoundingClientRect();
    drag.current = {
      key,
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - box.left + area.left,
      dy: event.clientY - box.top + area.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || !list.current) return;
    if (!state.moved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 6) return;
    state.moved = true;
    const area = list.current.getBoundingClientRect();
    const next = {
      key: state.key,
      x: Math.max(0, Math.min(area.width - 88, event.clientX - state.dx)),
      y: Math.max(0, Math.min(area.height - 90, event.clientY - state.dy)),
    };
    liftedRef.current = next;
    setLifted(next);
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!state?.moved) return;
    const placed = liftedRef.current;
    liftedRef.current = null;
    // Let go over a cloud browser's window: the file is given to the page there, from Drive.
    const file = files.find((candidate) => candidate.id === state.key);
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (file && under instanceof HTMLIFrameElement && under.dataset.session) {
      const box = under.getBoundingClientRect();
      postToBrowserWindow(under.dataset.session, {
        type: "brawzer:drop",
        fileIds: [file.id],
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
      setLifted(null);
      return;
    }
    if (placed?.key === state.key) setIconPosition(state.key, { x: placed.x, y: placed.y });
    setLifted(null);
  }

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
    <ul ref={list} className="dt-icons" data-style={style} aria-label="Desktop">
      {icons.map((icon) => {
        const placed = lifted?.key === icon.key ? lifted : positions[icon.key];
        return (
          <li
            key={icon.key}
            data-placed={placed ? true : undefined}
            data-lifted={lifted?.key === icon.key || undefined}
            style={placed ? { left: placed.x, top: placed.y } : undefined}
          >
            <button
              type="button"
              className="dt-dico"
              aria-pressed={selected === icon.key}
              onPointerDown={(event) => {
                startDrag(event, icon.key);
              }}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={() => {
                setSelected(icon.key);
              }}
              onDoubleClick={icon.open}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                if (event.key === "Enter") icon.open();
                const key = event.key.toLowerCase();
                if ((event.metaKey || event.ctrlKey) && icon.file && (key === "x" || key === "c")) {
                  event.preventDefault();
                  onHoldFile(icon.file, key === "x" ? "cut" : "copy");
                }
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
        );
      })}
    </ul>
  );
}
