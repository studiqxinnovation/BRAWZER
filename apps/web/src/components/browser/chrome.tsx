"use client";

import type { Profile, TabState, TransferMessage } from "@brawzer/contracts";
import { Mark } from "@brawzer/ui/brand";
import { Button } from "@brawzer/ui/components/button";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@brawzer/ui/components/menu";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@brawzer/ui/components/popover";
import { Spinner } from "@brawzer/ui/components/spinner";
import { Tooltip } from "@brawzer/ui/components/tooltip";
import { cn } from "@brawzer/ui/lib/cn";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Bookmark,
  BookmarkCheck,
  History,
  Smartphone,
  Camera,
  ChevronUp,
  ClipboardPaste,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  Ellipsis,
  FileText,
  Flag,
  Keyboard,
  KeyRound,
  Lock,
  LockOpen,
  AppWindow,
  LogOut,
  Maximize2,
  Plus,
  Printer,
  RotateCw,
  Search,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  Square,
  X,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type RefObject, type SubmitEvent, useEffect, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { formatBytes } from "@/lib/drive";
import { describeNavigationError } from "@/lib/browser/errors";
import { hostOf } from "@/lib/browser/input";
import { zoomLabel } from "@/lib/browser/zoom";
import { initialOf, profileColorShades } from "@/lib/profiles";

/** A tick in a menu item's icon slot, for a choice that is on. */
const Tick = ({ on }: { on: boolean }) => (
  <span aria-hidden="true" className="grid size-4 place-items-center">
    {on && (
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )}
  </span>
);

/** A stable colour for a site, from its host name, for the tab's initial. */
const TAB_HUES = [
  "#2b5cd9",
  "#0f8f6d",
  "#b8541d",
  "#7c3aed",
  "#1b3a6b",
  "#c2326a",
  "#2d8a3e",
  "#4b5563",
];
export function tabColor(url: string): string {
  const host = hostOf(url);
  if (!host) return "#6b7280";
  let hash = 0;
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TAB_HUES[hash % TAB_HUES.length] ?? "#6b7280";
}

/** Brawzer's own start page (served inside the container) or nothing yet: shown as a new tab. */
/** A page Brawzer can bookmark or remember: http or https, not its own start page. */
export function canBookmark(url: string): boolean {
  if (isStartPage(url) || url.length > 2048) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** The star beside the address: bookmarks the page in the session's profile (ADR 0020). */
export function BookmarkStar({
  bookmarked,
  busy,
  onToggle,
}: {
  bookmarked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const label = bookmarked ? "Remove bookmark" : "Bookmark this page";
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-10 rounded-xl"
        aria-label={label}
        aria-pressed={bookmarked}
        disabled={busy}
        onClick={onToggle}
      >
        {bookmarked ? (
          <BookmarkCheck aria-hidden="true" className="text-accent-ink" />
        ) : (
          <Bookmark aria-hidden="true" />
        )}
      </Button>
    </Tooltip>
  );
}

export function isStartPage(url: string): boolean {
  return url === "" || url === "about:blank" || hostOf(url) === "bee.invalid";
}

export function tabTitle(tab: TabState): string {
  if (isStartPage(tab.url)) return "New tab";
  return tab.title || hostOf(tab.url) || "New tab";
}

/** How long the pointer rests on a tab before its preview shows. */
const PREVIEW_DELAY_MS = 450;

export function TabStrip({
  tabs,
  activeTabId,
  favicons,
  previews,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: readonly TabState[];
  activeTabId: string | null;
  /** Site icons by tab id, as data URLs the container fetched. */
  favicons?: ReadonlyMap<string, string>;
  /** Small pictures of each tab as last drawn, by tab id. */
  previews?: ReadonlyMap<string, string>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = (next: { id: string; left: number; top: number } | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (!next) {
      setHover(null);
      return;
    }
    hoverTimer.current = setTimeout(() => {
      setHover(next);
    }, PREVIEW_DELAY_MS);
  };
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );
  const hovered = hover ? tabs.find((tab) => tab.id === hover.id) : undefined;
  const preview = hover && hovered ? previews?.get(hover.id) : undefined;
  return (
    <div className="flex items-end gap-1 overflow-x-auto bg-surface-raised px-2 pt-2">
      {hovered && hover && preview && (
        <div
          role="presentation"
          data-testid="tab-preview"
          className="pointer-events-none fixed z-50 w-72 overflow-hidden rounded-xl border border-line bg-canvas shadow-lg"
          style={{ left: hover.left, top: hover.top }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made here, not an asset */}
          <img src={preview} alt="" className="block w-full" />
          <div className="border-t border-line px-3 py-2">
            <div className="truncate text-footnote font-medium text-ink">{tabTitle(hovered)}</div>
            <div className="truncate text-caption text-ink-secondary">{hostOf(hovered.url)}</div>
          </div>
        </div>
      )}
      <span className="mr-1 mb-1.5 flex size-8 items-center justify-center text-ink">
        <Mark size={18} title="Bee Browser" />
      </span>
      <div role="tablist" aria-label="Tabs" className="flex min-w-0 items-end gap-1">
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId;
          const title = tabTitle(tab);
          const initial =
            title === "New tab" ? "+" : (hostOf(tab.url)[0] ?? title[0] ?? "·").toUpperCase();
          return (
            // The tab itself carries the role; the close control sits inside it.
            <div
              key={tab.id}
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls="browser-viewport"
              title={title}
              className={cn(
                "group flex h-10 max-w-60 min-w-32 cursor-default items-center gap-2 rounded-t-xl border border-b-0 pr-1.5 pl-2.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                selected
                  ? "border-line bg-canvas text-ink"
                  : "border-transparent text-ink-secondary hover:bg-hover",
              )}
              onClick={(event) => {
                settle(null);
                if ((event.target as HTMLElement).closest("[data-tab-close]")) onClose(tab.id);
                else if (!selected) onActivate(tab.id);
              }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "mouse") return;
                const rect = event.currentTarget.getBoundingClientRect();
                settle({
                  id: tab.id,
                  left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
                  top: rect.bottom + 6,
                });
              }}
              onPointerLeave={() => {
                settle(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (!selected) onActivate(tab.id);
                } else if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              {favicons?.get(tab.id) && !tab.loading ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data URL the container fetched, not an asset
                <img
                  src={favicons.get(tab.id)}
                  alt=""
                  data-testid="tab-icon"
                  className="size-4 shrink-0 rounded-sm object-contain"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                  style={{ backgroundColor: tabColor(tab.url) }}
                >
                  {tab.loading ? <Spinner className="size-3 text-white" /> : initial}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-left text-footnote">{title}</span>
              {/* A mouse target only: keyboard users close the focused tab with Delete or Alt+W. */}
              <span
                aria-hidden="true"
                data-tab-close
                data-testid="tab-close"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-tertiary opacity-70 group-hover:opacity-100 hover:bg-hover hover:text-ink"
              >
                <X className="size-3.5" />
              </span>
            </div>
          );
        })}
      </div>
      <Tooltip content="New tab (Alt+T)">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New tab"
          className="mb-1"
          onClick={onNew}
        >
          <Plus aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}

/** The address: host and path apart when shown, one field when edited. */
export function AddressBar({
  tab,
  value,
  editing,
  inputRef,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  onEscape,
  onResetZoom,
  onLeaveReader,
}: {
  tab: TabState | null;
  value: string;
  editing: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onEscape: () => void;
  onResetZoom?: () => void;
  onLeaveReader?: () => void;
}) {
  const host = tab ? hostOf(tab.url) : "";
  const shownPath = (() => {
    if (!tab) return "";
    try {
      const url = new URL(tab.url);
      const path = `${url.pathname}${url.search}`;
      return path === "/" ? "" : path;
    } catch {
      return "";
    }
  })();
  const newTab = !tab || isStartPage(tab.url);
  return (
    <form method="post" onSubmit={onSubmit} className="flex min-w-0 flex-1 items-center">
      <label htmlFor="browser-address" className="sr-only">
        Address or search
      </label>
      <div className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--bw-accent-soft)]">
        {tab && !newTab && tab.security === "secure" && (
          <Lock aria-label="Secure connection" className="size-3.5 shrink-0 text-ink-secondary" />
        )}
        {tab && !newTab && tab.security === "insecure" && (
          <LockOpen aria-label="Not secure" className="size-3.5 shrink-0 text-warning" />
        )}
        {/* The shown address lies over the field itself, so it ends where the
            field does: a long address is cut short there, never drawn on over
            the buttons beside it. */}
        <div className="relative flex min-w-0 flex-1 items-center">
          {!editing && !newTab && (
            <span
              aria-hidden="true"
              data-address-shown=""
              className="pointer-events-none absolute inset-0 flex items-center gap-1 overflow-hidden text-callout whitespace-nowrap"
            >
              <span className="max-w-full shrink-0 truncate text-ink">{host}</span>
              <span className="min-w-0 truncate text-ink-tertiary">{shownPath}</span>
            </span>
          )}
          <input
            ref={inputRef}
            id="browser-address"
            name="address"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={newTab ? "Search or type an address" : ""}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-callout text-ink outline-none placeholder:text-ink-tertiary",
              !editing && !newTab && "text-transparent caret-transparent",
            )}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            onFocus={(event) => {
              onFocus();
              event.target.select();
            }}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (event.key === "Escape") onEscape();
            }}
          />
        </div>
        {tab?.reader && (
          <Tooltip content="Reader view: the article without the rest of the page. Click to leave.">
            <button
              type="button"
              className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent-soft px-2 text-caption font-medium text-accent-ink hover:bg-hover"
              onClick={onLeaveReader}
            >
              <BookOpenText aria-hidden="true" className="size-3.5" />
              Reader
            </button>
          </Tooltip>
        )}
        {tab && Math.abs(tab.zoom - 1) > 0.001 && (
          <Tooltip content="Zoom. Click to reset.">
            <button
              type="button"
              className="flex h-7 shrink-0 items-center rounded-md bg-hover px-2 text-caption font-medium text-ink-secondary hover:text-ink"
              aria-label={`Zoom ${zoomLabel(tab.zoom)}, reset`}
              onClick={onResetZoom}
            >
              {zoomLabel(tab.zoom)}
            </button>
          </Tooltip>
        )}
      </div>
    </form>
  );
}

/** Find in page: Brawzer's bar under the address, asking the engine for each match. */
export function FindBar({
  text,
  result,
  onChange,
  onStep,
  onClose,
}: {
  text: string;
  result: { matches: number; active: number } | null;
  onChange: (text: string) => void;
  onStep: (forward: boolean) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const nothing = text !== "" && result !== null && result.matches === 0;
  return (
    <div
      role="search"
      aria-label="Find in page"
      className="flex items-center gap-2 border-b border-line bg-surface-raised px-3 py-1.5"
    >
      <label htmlFor="browser-find" className="sr-only">
        Find in page
      </label>
      <input
        ref={inputRef}
        id="browser-find"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="Find in page"
        className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 text-callout text-ink outline-none focus:border-accent sm:max-w-80"
        value={text}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onStep(!event.shiftKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span
        aria-live="polite"
        className={cn("min-w-16 text-footnote", nothing ? "text-danger" : "text-ink-secondary")}
      >
        {text === "" || result === null
          ? ""
          : result.matches === 0
            ? "No matches"
            : `${String(result.active)} of ${String(result.matches)}`}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        disabled={!result || result.matches === 0}
        onClick={() => {
          onStep(false);
        }}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        disabled={!result || result.matches === 0}
        onClick={() => {
          onStep(true);
        }}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close find" onClick={onClose}>
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

export function IsolatedBadge() {
  return (
    <Tooltip content="This website runs in Brawzer's cloud. Only its pixels reach this computer.">
      <span className="hidden h-10 items-center gap-1.5 rounded-xl border border-success/30 bg-success-soft px-3 text-callout font-medium text-success sm:inline-flex">
        <ShieldCheck aria-hidden="true" className="size-4" />
        Isolated
      </span>
    </Tooltip>
  );
}

/** The profile this session runs under, with the session's own actions. */
export function ProfileChip({ profile, onEnd }: { profile: Profile | null; onEnd: () => void }) {
  const name = profile?.name ?? "Temporary";
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="secondary" size="sm" className="h-10 rounded-xl pr-2 pl-1.5" />}
      >
        <span className="sr-only">Profile</span>
        {profile ? (
          <ProfileAvatar
            initial={initialOf(profile.name)}
            color={profileColorShades[profile.color].hex}
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full bg-hover text-caption text-ink-secondary"
          >
            T
          </span>
        )}
        <span className="hidden max-w-32 truncate sm:inline">{name}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 text-ink-tertiary" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuGroup>
          <MenuGroupLabel>
            {profile
              ? profile.keepData
                ? "Cookies and history are kept in this profile"
                : "This profile keeps nothing between sessions"
              : "A temporary session: nothing is kept"}
          </MenuGroupLabel>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} tone="danger" onClick={onEnd}>
          End session
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** A file on its way to Drive, as the downloads panel shows it. */
export interface RecentTransfer {
  id: string;
  filename: string;
  kind: TransferMessage["kind"];
  state: TransferMessage["state"];
  bytes: number;
  reason?: string | undefined;
}

export function DownloadsButton({
  transfers,
  unseen,
  onOpen,
}: {
  transfers: readonly RecentTransfer[];
  unseen: boolean;
  onOpen: () => void;
}) {
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative size-10 rounded-xl"
            aria-label={unseen ? "Downloads, new files saved" : "Downloads"}
          />
        }
      >
        <Download aria-hidden="true" />
        {unseen && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent"
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle>Saved to Brawzer Drive</PopoverTitle>
        {transfers.length === 0 ? (
          <p className="mt-2 max-w-64 text-footnote text-ink-secondary">
            Downloads and printed pages from this session are scanned and saved to Drive, never to
            this computer.
          </p>
        ) : (
          <ul className="mt-3 flex w-72 flex-col gap-2" aria-label="Files from this session">
            {transfers.map((transfer) => {
              const failed =
                transfer.state === "failed" ||
                transfer.state === "too_large" ||
                transfer.state === "canceled";
              const busy = transfer.state === "started" || transfer.state === "received";
              return (
                <li key={transfer.id} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      transfer.state === "quarantined" || failed
                        ? "bg-danger-soft text-danger"
                        : "bg-hover text-ink-secondary",
                    )}
                  >
                    <FileText aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-callout text-ink">
                      {transfer.filename}
                    </span>
                    <span className="block text-caption text-ink-tertiary">
                      {busy
                        ? transfer.kind === "print"
                          ? "Printing…"
                          : "Downloading…"
                        : transfer.state === "saved"
                          ? `${formatBytes(transfer.bytes)} · Scanned`
                          : transfer.state === "quarantined"
                            ? `${formatBytes(transfer.bytes)} · Quarantined`
                            : transfer.state === "too_large"
                              ? "Too large for Drive"
                              : (transfer.reason ?? "Not saved")}
                    </span>
                  </span>
                  {busy ? (
                    <Spinner className="size-4 text-ink-tertiary" />
                  ) : transfer.state === "saved" ? (
                    <Check aria-label="Saved" className="size-4 text-success" />
                  ) : transfer.state === "quarantined" ? (
                    <ShieldAlert aria-label="Quarantined" className="size-4 text-danger" />
                  ) : (
                    <CircleAlert aria-label="Not saved" className="size-4 text-danger" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <a
          href="/app/drive"
          target="_blank"
          rel="noopener"
          className="mt-3 inline-block text-footnote text-accent-ink hover:underline"
        >
          Open Drive
        </a>
      </PopoverContent>
    </Popover>
  );
}

export function MoreMenu({
  canPrint,
  coarsePointer,
  zoom,
  reader,
  onNewTab,
  onPrint,
  onFind,
  onCopy,
  onPaste,
  onZoom,
  onReader,
  onFullScreen,
  onKeyboard,
  onShortcuts,
  onEnd,
  onScreenshot,
  onReport,
  onHistory,
  onPasswords,
  onHandOff,
  onPopOut,
  onCloseWindow,
  caption,
}: {
  canPrint: boolean;
  coarsePointer: boolean;
  zoom: number;
  reader: boolean;
  onNewTab: () => void;
  onPrint: () => void;
  onFind: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onZoom: (direction: 1 | -1 | 0) => void;
  onReader: () => void;
  onFullScreen: () => void;
  onKeyboard: () => void;
  onShortcuts: () => void;
  onEnd: () => void;
  onScreenshot: () => void;
  onReport: () => void;
  /** With a profile: its history and bookmarks. */
  onHistory?: (() => void) | undefined;
  /** Where the person's saved passwords are (ADR 0021). */
  onPasswords: () => void;
  /** With a profile that keeps its data: end here, continue elsewhere. */
  onHandOff?: (() => void) | undefined;
  /** In the app: open this session in a window of its own. */
  onPopOut?: (() => void) | undefined;
  /** In that window: close it (the session keeps running). */
  onCloseWindow?: (() => void) | undefined;
  /** What has focus in the page, written under it for anyone who can't see the canvas. */
  caption?: { on: boolean; onToggle: () => void };
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="size-10 rounded-xl" aria-label="More" />
        }
      >
        <Ellipsis aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end">
        {caption && (
          <MenuItem icon={<Tick on={caption.on} />} onClick={caption.onToggle}>
            Show what has focus
          </MenuItem>
        )}
        <MenuItem icon={<Plus />} onClick={onNewTab}>
          New tab
        </MenuItem>
        {onHistory && (
          <MenuItem icon={<History />} onClick={onHistory}>
            History and bookmarks
          </MenuItem>
        )}
        <MenuItem icon={<KeyRound />} onClick={onPasswords}>
          Saved passwords
        </MenuItem>
        <MenuItem icon={<Printer />} disabled={!canPrint} onClick={onPrint}>
          Save page as PDF in Drive
        </MenuItem>
        <MenuItem icon={<Camera />} disabled={!canPrint} onClick={onScreenshot}>
          Save a screenshot in Drive
        </MenuItem>
        <MenuItem icon={<Search />} disabled={!canPrint} onClick={onFind}>
          Find in page
        </MenuItem>
        <MenuItem icon={<Copy />} disabled={!canPrint} onClick={onCopy}>
          Copy selection to this computer
        </MenuItem>
        <MenuItem icon={<ClipboardPaste />} disabled={!canPrint} onClick={onPaste}>
          Paste from this computer
        </MenuItem>
        <MenuItem
          icon={reader ? <SearchX /> : <BookOpenText />}
          disabled={!canPrint}
          onClick={onReader}
        >
          {reader ? "Leave reader view" : "Reader view"}
        </MenuItem>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Zoom · {zoomLabel(zoom)}</MenuGroupLabel>
        </MenuGroup>
        <MenuItem
          icon={<ZoomIn />}
          disabled={!canPrint}
          onClick={() => {
            onZoom(1);
          }}
        >
          Zoom in
        </MenuItem>
        <MenuItem
          icon={<ZoomOut />}
          disabled={!canPrint}
          onClick={() => {
            onZoom(-1);
          }}
        >
          Zoom out
        </MenuItem>
        <MenuItem
          icon={<RotateCw />}
          disabled={!canPrint || Math.abs(zoom - 1) < 0.001}
          onClick={() => {
            onZoom(0);
          }}
        >
          Reset zoom
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Maximize2 />} onClick={onFullScreen}>
          Full screen
        </MenuItem>
        {onPopOut && (
          <MenuItem icon={<AppWindow />} onClick={onPopOut}>
            Open in its own window
          </MenuItem>
        )}
        {onCloseWindow && (
          <MenuItem icon={<AppWindow />} onClick={onCloseWindow}>
            Close this window
          </MenuItem>
        )}
        {onHandOff && (
          <MenuItem icon={<Smartphone />} onClick={onHandOff}>
            Continue on another device
          </MenuItem>
        )}
        {coarsePointer ? (
          <MenuItem icon={<Keyboard />} onClick={onKeyboard}>
            Type into the page
          </MenuItem>
        ) : (
          <MenuItem icon={<Keyboard />} onClick={onShortcuts}>
            Keyboard shortcuts
          </MenuItem>
        )}
        <MenuItem icon={<Flag />} onClick={onReport}>
          Report a problem with this page
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} tone="danger" onClick={onEnd}>
          End session
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function NavButtons({
  tab,
  onBack,
  onForward,
  onReload,
  onStop,
}: {
  tab: TabState | null;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex items-center">
      <Tooltip content="Back (Alt+←)">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          disabled={!tab?.canGoBack}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Forward (Alt+→)">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          disabled={!tab?.canGoForward}
          onClick={onForward}
        >
          <ArrowRight aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content={tab?.loading ? "Stop" : "Reload (Alt+R)"}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={tab?.loading ? "Stop loading" : "Reload"}
          disabled={!tab}
          onClick={tab?.loading ? onStop : onReload}
        >
          {tab?.loading ? <Square aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
        </Button>
      </Tooltip>
    </div>
  );
}

export function StatusBar({
  region,
  engine,
  proxy,
  profile,
  remaining,
  sound,
  link,
}: {
  region: string | null;
  engine: string;
  proxy: { name: string; protocol: string } | null;
  profile: Profile | null;
  remaining: string;
  sound: { on: boolean; unlocked: boolean; onToggle: () => void };
  /** The link as measured here: round trip to the container, frames drawn a second. */
  link?: { latencyMs: number | null; fps: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-surface-raised px-4 py-1.5 text-footnote text-ink-secondary">
      <Tooltip
        content={
          !sound.on
            ? "Sound is off. Click to hear the page."
            : sound.unlocked
              ? "Sound is on. Click to mute."
              : "Sound plays once you click or type in the page."
        }
      >
        <button
          type="button"
          aria-pressed={sound.on}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-ink-secondary hover:bg-hover hover:text-ink"
          onClick={sound.onToggle}
        >
          {sound.on ? (
            <Volume2 aria-hidden="true" className="size-3.5" />
          ) : (
            <VolumeX aria-hidden="true" className="size-3.5" />
          )}
          {sound.on ? (sound.unlocked ? "Sound on" : "Sound on · click the page") : "Sound off"}
        </button>
      </Tooltip>
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        Cloud session{region ? ` · ${region}` : ""}
        {engine ? ` · ${engine}` : ""}
      </span>
      <span>
        {proxy ? `Proxy · ${proxy.protocol.toUpperCase()} · ${proxy.name}` : "Direct connection"}
      </span>
      {link && (
        <Tooltip content="Round trip from here to the cloud browser and back, and frames drawn in the last second. A still page draws none.">
          <span className="tabular-nums" data-testid="link-stats">
            {link.latencyMs === null ? "— ms" : `${String(link.latencyMs)} ms`}
            {` · ${String(link.fps)} fps`}
          </span>
        </Tooltip>
      )}
      <span className="ml-auto flex items-center gap-4">
        <span>
          {profile?.keepData
            ? "Cookies and history kept in the cloud"
            : profile
              ? "Nothing kept after this session"
              : "Temporary session · nothing kept"}
        </span>
        <span aria-live="polite">Ends in {remaining} at most</span>
      </span>
    </div>
  );
}

/**
 * Drawn by Brawzer over the engine's own error page, which is the one piece
 * of engine chrome a person would otherwise still see. The address stays in
 * the bar; the actions are the page's own.
 */
export function NavigationErrorPage({
  tab,
  onRetry,
  onCopy,
  onSearch,
  onReport,
}: {
  tab: TabState;
  onRetry: () => void;
  onCopy: () => void;
  onSearch: () => void;
  onReport: () => void;
}) {
  if (!tab.error) return null;
  const text = describeNavigationError(tab.error.code, tab.error.url);
  const Icon = text.kind === "blocked" ? ShieldAlert : CircleAlert;
  return (
    <div
      role="region"
      aria-label="This page couldn’t be opened"
      data-testid="navigation-error"
      data-error-kind={text.kind}
      className="absolute inset-0 flex items-center justify-center overflow-auto bg-canvas px-6 py-10"
    >
      <div className="flex w-full max-w-md flex-col items-start gap-4">
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-2xl",
            text.kind === "blocked"
              ? "bg-success-soft text-success"
              : "bg-hover text-ink-secondary",
          )}
        >
          <Icon aria-hidden="true" className="size-6" />
        </span>
        <h2 className="text-title-2 text-balance text-ink">{text.title}</h2>
        <p className="text-body text-pretty text-ink-secondary">{text.detail}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onRetry}>
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
          <Button variant="secondary" onClick={onCopy}>
            <Copy aria-hidden="true" />
            Copy the address
          </Button>
          {(text.kind === "unresolved" || text.kind === "address") && (
            <Button variant="secondary" onClick={onSearch}>
              <Search aria-hidden="true" />
              Search for it
            </Button>
          )}
          {(text.kind === "blocked" || text.kind === "relay") && (
            <Button variant="ghost" onClick={onReport}>
              <Flag aria-hidden="true" />
              Report it
            </Button>
          )}
        </div>
        {tab.error.code !== "" && (
          <p className="text-caption text-ink-tertiary">
            The engine reported <code className="font-mono">{tab.error.code}</code>.
          </p>
        )}
      </div>
    </div>
  );
}
