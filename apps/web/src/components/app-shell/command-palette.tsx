"use client";

import { Dialog, DialogContent, DialogTitle } from "@brawzer/ui/components/dialog";
import { Kbd } from "@brawzer/ui/components/kbd";
import { cn } from "@brawzer/ui/lib/cn";
import { AppWindow, CornerDownLeft, Search } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type ComponentType, type KeyboardEvent, useEffect, useId, useState } from "react";
import { appNav } from "@/content/app";

const OPEN_EVENT = "brawzer:open-command-palette";

/** Opens the palette from anywhere in the app, such as Home's search button. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Command {
  label: string;
  hint: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
}

const COMMANDS: readonly Command[] = [
  {
    label: "Open a browser",
    hint: "Bee, Chrome, Firefox and the others",
    href: "/app/browser?new=1",
    icon: AppWindow,
  },
  ...appNav.flatMap((group) =>
    group.items.map((item) => ({
      label: item.label,
      hint: group.label ? `Go to ${item.label}, in ${group.label}` : `Go to ${item.label}`,
      href: item.href,
      icon: item.icon,
    })),
  ),
];

/**
 * "Go to": every page of the app and opening a browser, found by typing.
 * ⌘K or Ctrl+K anywhere in the app opens it.
 */
export function CommandPalette() {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const show = () => {
      setQuery("");
      setActive(0);
      setOpen(true);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = COMMANDS.filter((command) =>
    words.every((word) => `${command.label} ${command.hint}`.toLowerCase().includes(word)),
  );
  const current = Math.min(active, Math.max(0, matches.length - 1));

  function go(command: Command | undefined) {
    if (!command) return;
    setOpen(false);
    router.push(command.href as Route);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(matches[current]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[18vh] w-[min(36rem,calc(100vw-2rem))] translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search aria-hidden="true" className="size-4 shrink-0 text-ink-tertiary" />
          <input
            // The palette exists to be typed into the moment it opens.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={matches[current] ? `${listId}-${String(current)}` : undefined}
            aria-label="Go to a page, or open a browser"
            placeholder="Go to a page, or open a browser…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-tertiary"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div id={listId} role="listbox" aria-label="Pages" className="max-h-80 overflow-y-auto p-2">
          {matches.map((command, index) => {
            const Icon = command.icon;
            const selected = index === current;
            return (
              <div
                key={command.href}
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onMouseMove={() => {
                  setActive(index);
                }}
                onClick={() => {
                  go(command);
                }}
                // Keys stay with the search field (aria-activedescendant), as a combobox's do.
                onKeyDown={() => undefined}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5",
                  selected && "bg-hover",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-secondary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-callout font-medium text-ink">{command.label}</span>
                  <span className="block truncate text-footnote text-ink-secondary">
                    {command.hint}
                  </span>
                </span>
                {selected && (
                  <CornerDownLeft aria-hidden="true" className="size-4 text-ink-tertiary" />
                )}
              </div>
            );
          })}
          {matches.length === 0 && (
            <p className="px-3 py-6 text-center text-callout text-ink-secondary">
              Nothing matches “{query.trim()}”.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
