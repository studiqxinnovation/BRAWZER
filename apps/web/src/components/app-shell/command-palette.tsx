"use client";

import { type BrowserEngine, type BrowserSession, engineDetails } from "@brawzer/contracts";
import { Dialog, DialogContent, DialogTitle } from "@brawzer/ui/components/dialog";
import { Kbd } from "@brawzer/ui/components/kbd";
import { cn } from "@brawzer/ui/lib/cn";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from "react";
import { EngineLogo } from "@/components/browser/engine-logo";
import { useDesktop } from "@/components/desktop/desktop-context";
import { AppIcon, appIds, apps } from "@/components/desktop/apps/registry";
import { appNav } from "@/content/app";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { useLaunchBrowser } from "@/lib/browser/use-launch";

const OPEN_EVENT = "brawzer:open-command-palette";

/** Opens the palette from anywhere in the app, such as Home's search button. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Command {
  key: string;
  label: string;
  /** Shown on the right, as the design has it: "Launch", "Security settings". */
  hint: string;
  /** Matched by typing as well as the label. */
  words: string;
  icon: ReactNode;
  run: () => void;
}

const PAGE_HINTS: Record<string, string> = {
  "/app": "Your dashboard",
  "/app/browser": "Every browser",
  "/app/profiles": "Manage profiles",
  "/app/drive": "Your files",
  "/app/proxy": "Proxy settings",
  "/app/extensions": "Add-ons",
  "/app/shield": "Security settings",
  "/app/site-rules": "Allow and block",
  "/app/sessions": "Signed-in devices",
  "/app/team": "People",
  "/app/account": "Plan and sign-in",
};

/** A page's icon in a small tile, beside the browsers' logos. */
function PageIcon({ icon: Icon }: { icon: (typeof appNav)[number]["items"][number]["icon"] }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-hover">
      <Icon aria-hidden="true" className="size-4 text-ink-secondary" />
    </span>
  );
}

/**
 * Quick launch: the browsers first (choosing one opens it, or goes back to it
 * if it's open), then every page of the app, found by typing. ⌘K or Ctrl+K
 * anywhere in the app opens it.
 */
export function CommandPalette() {
  const router = useRouter();
  const listId = useId();
  const { launch } = useLaunchBrowser();
  const desktop = useDesktop();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [browsers, setBrowsers] = useState<{
    engines: readonly BrowserEngine[];
    sessions: readonly BrowserSession[];
  } | null>(null);

  useEffect(() => {
    const show = () => {
      setQuery("");
      setActive(0);
      setOpen(true);
      // What's offered and what's open now, read as it opens.
      void fetchBrowserOverview().then((result) => {
        if (result.ok) {
          setBrowsers({ engines: result.data.engines, sessions: result.data.sessions });
        }
      });
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

  const commands: Command[] = [
    ...(browsers?.engines ?? []).map((engine) => {
      const details = engineDetails[engine];
      const running = browsers?.sessions.some((session) => session.engine === engine) ?? false;
      return {
        key: `browser:${engine}`,
        label: details.short,
        hint: running ? "Open now" : "Launch",
        words: `${details.name} browser launch open`,
        icon: (
          <span className="grid size-7 shrink-0 place-items-center">
            <EngineLogo engine={engine} size="md" />
          </span>
        ),
        run: () => void launch(engine),
      };
    }),
    // The desktop's apps, where there is a desktop to open them on.
    ...(desktop
      ? appIds.map((app) => ({
          key: `app:${app}`,
          label: apps[app].name,
          hint: "Open app",
          words: `${apps[app].description} ${apps[app].category} app`,
          icon: <AppIcon app={app} size={28} />,
          run: () => {
            desktop.openApp(app);
          },
        }))
      : []),
    ...appNav.flatMap((group) =>
      group.items.map((item) => ({
        key: item.href,
        label: item.label,
        hint: PAGE_HINTS[item.href] ?? `Go to ${item.label}`,
        words: `${group.label ?? ""} page go`,
        icon: <PageIcon icon={item.icon} />,
        run: () => {
          router.push(item.href);
          desktop?.showDashboard();
        },
      })),
    ),
  ];

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = commands.filter((command) =>
    words.every((word) =>
      `${command.label} ${command.hint} ${command.words}`.toLowerCase().includes(word),
    ),
  );
  const current = Math.min(active, Math.max(0, matches.length - 1));

  function go(command: Command | undefined) {
    if (!command) return;
    setOpen(false);
    command.run();
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
      <DialogContent className="top-[18vh] w-[min(32rem,calc(100vw-2rem))] translate-y-0 gap-0 overflow-hidden rounded-[1.375rem] p-0">
        <DialogTitle className="sr-only">Quick launch</DialogTitle>
        <div className="flex items-center gap-2.5 px-4">
          <Search aria-hidden="true" className="size-4 shrink-0 text-ink-tertiary" />
          <input
            // Quick launch exists to be typed into the moment it opens.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={matches[current] ? `${listId}-${String(current)}` : undefined}
            aria-label="Launch a browser or search"
            placeholder="Launch a browser or search…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 min-w-0 flex-1 bg-transparent text-[0.95rem] font-medium text-ink outline-none placeholder:text-ink-tertiary"
          />
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label="Browsers and pages"
          className="max-h-[22rem] overflow-y-auto border-y border-line p-2"
        >
          {matches.map((command, index) => {
            const selected = index === current;
            return (
              <div
                key={command.key}
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
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2",
                  selected && "bg-accent-soft",
                )}
              >
                {command.icon}
                <span className="text-callout font-semibold text-ink">{command.label}</span>
                <span className="ml-auto text-footnote text-ink-tertiary">{command.hint}</span>
              </div>
            );
          })}
          {matches.length === 0 && (
            <p className="px-3 py-5 text-center text-callout text-ink-secondary">
              Nothing matches “{query.trim()}”.
            </p>
          )}
        </div>
        <p className="flex gap-4 px-3.5 py-2 text-[0.72rem] text-ink-tertiary" aria-hidden="true">
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
