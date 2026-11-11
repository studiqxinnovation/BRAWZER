"use client";

import { AppIconArt } from "@/components/browser/engine-logo";
import { AppIcon } from "./apps/registry";
import { BrawzerTile } from "./dock";
import { type DesktopWindow, windowLabel } from "./windows";

/**
 * The window switcher (Alt+`, or Option+` on a Mac): the windows in the order
 * they were last used. Held Alt and ` again moves along; letting go of Alt
 * goes to the chosen one, Escape stays put.
 */
export function WindowSwitcher({
  entries,
  selected,
}: {
  entries: readonly ("dashboard" | DesktopWindow)[];
  selected: number;
}) {
  return (
    <div className="dt-switcher" role="listbox" aria-label="Windows" aria-orientation="horizontal">
      {entries.map((entry, index) => {
        const label = entry === "dashboard" ? "Brawzer" : windowLabel(entry);
        return (
          <div
            key={entry === "dashboard" ? "dashboard" : entry.id}
            role="option"
            aria-selected={index === selected}
            className="dt-switch-item"
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
