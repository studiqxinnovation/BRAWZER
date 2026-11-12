"use client";

import { useEffect } from "react";
import { AppIconArt } from "@/components/browser/engine-logo";
import { AppIcon } from "./apps/registry";
import type { Rect } from "./window-chrome";
import { type DesktopWindow, windowLabel, windowTitle } from "./windows";

export interface OverviewCell {
  id: string;
  title: string;
  label: string;
  rect: Rect;
}

/**
 * Mission Control (Task View on Windows): every window flown to a cell of a
 * grid, each named; the windows in the Dock in a row below. Choosing one
 * brings it forward; Escape, F3 or a click on the desktop puts them back.
 * The windows themselves are moved (a transform on each); this draws the
 * names and takes the clicks over them.
 */
export function Overview({
  cells,
  minimised,
  style,
  spaces,
  onSpace,
  onAddSpace,
  onRemoveSpace,
  onChoose,
  onClose,
}: {
  cells: readonly OverviewCell[];
  minimised: readonly DesktopWindow[];
  style: "mac" | "windows";
  /** The desktops: how many, which shows. */
  spaces: { count: number; current: number };
  onSpace: (space: number) => void;
  onAddSpace: () => void;
  onRemoveSpace: (space: number) => void;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="dt-overview"
      role="dialog"
      aria-label={style === "windows" ? "Task View" : "Mission Control"}
    >
      {/* The backdrop: a click on the desktop puts the windows back. */}
      <button
        type="button"
        className="dt-ov-back"
        aria-label="Back to the desktop"
        onClick={onClose}
      />
      <div className="dt-ov-spaces" role="tablist" aria-label="Desktops">
        {Array.from({ length: spaces.count }, (_value, index) => index + 1).map((which) => (
          <span key={which} className="dt-ov-space">
            <button
              type="button"
              role="tab"
              aria-selected={which === spaces.current}
              className="dt-ov-space-b"
              onClick={() => {
                onSpace(which);
              }}
            >
              Desktop {which}
            </button>
            {which > 1 && (
              <button
                type="button"
                className="dt-ov-space-x"
                aria-label={`Remove Desktop ${String(which)}; its windows join Desktop 1`}
                onClick={() => {
                  onRemoveSpace(which);
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button type="button" className="dt-ov-space-b dt-ov-space-add" onClick={onAddSpace}>
          + New desktop
        </button>
      </div>
      {cells.map((cell, index) => (
        <button
          key={cell.id}
          type="button"
          className="dt-ov-cell"
          data-testid="overview-window"
          style={{
            left: cell.rect.left,
            top: cell.rect.top,
            width: cell.rect.width,
            height: cell.rect.height,
          }}
          // The frontmost window is where focus starts, as it was.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={index === 0}
          onClick={() => {
            onChoose(cell.id);
          }}
        >
          <span className="dt-ov-name">{cell.title}</span>
        </button>
      ))}
      {cells.length === 0 && <p className="dt-ov-empty">No windows are open.</p>}
      {minimised.length > 0 && (
        <div className="dt-ov-strip" aria-label="Windows in the Dock">
          {minimised.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="dt-ov-min"
              onClick={() => {
                onChoose(entry.id);
              }}
            >
              {entry.content.kind === "browser" ? (
                <span className="dt-switch-art" aria-hidden="true">
                  <AppIconArt engine={entry.content.session.engine} />
                </span>
              ) : (
                <AppIcon app={entry.content.app} size={48} />
              )}
              <span>{windowTitle(entry)}</span>
              <span className="sr-only">, {windowLabel(entry)} window, in the Dock</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
