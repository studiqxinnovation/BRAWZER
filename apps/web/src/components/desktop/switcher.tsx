"use client";

import { AppIconArt } from "@/components/browser/engine-logo";
import { AppIcon } from "./apps/registry";
import { BrawzerTile } from "./dock";
import { type DesktopWindow, windowLabel } from "./windows";

/**
 * The window switcher (Alt+`, or Option+` on a Mac): the windows in the order
 * they were last used. Held Alt and ` again moves along, as do the arrow
 * keys; letting go of Alt goes to the chosen one, Escape stays put, and a
 * click chooses. (⌘Tab and Alt+Tab belong to the computer itself; a browser
 * never sees them.)
 */
export function WindowSwitcher({
  entries,
  selected,
  onChoose,
}: {
  entries: readonly ("dashboard" | DesktopWindow)[];
  selected: number;
  /** Clicking an entry goes to it, as on a Mac. */
  onChoose?: (index: number) => void;
}) {
  return (
    <div className="dt-switcher" role="listbox" aria-label="Windows" aria-orientation="horizontal">
      {entries.map((entry, index) => {
        const label = entry === "dashboard" ? "Brawzer" : windowLabel(entry);
        return (
          // The switcher is driven by the held key; the mouse is a second way in.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <div
            key={entry === "dashboard" ? "dashboard" : entry.id}
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            className="dt-switch-item"
            onClick={() => onChoose?.(index)}
          >
            {entry === "dashboard" ? (
              <BrawzerTile size={58} />
            ) : entry.content.kind === "browser" ? (
              <span className="dt-switch-art" aria-hidden="true">
                <AppIconArt engine={entry.content.session.engine} />
              </span>
            ) : (
              <AppIcon app={entry.content.app} size={58} />
            )}
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
