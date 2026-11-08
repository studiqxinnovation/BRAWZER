"use client";

import type { Profile, TabState, TransferMessage } from "@brawzer/contracts";
import { Mark } from "@brawzer/ui/brand";
import { Button } from "@brawzer/ui/components/button";
import {
  Menu,
  MenuContent,
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
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Ellipsis,
  FileText,
  Keyboard,
  Lock,
  LockOpen,
  LogOut,
  Maximize2,
  Plus,
  Printer,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { type RefObject, type SubmitEvent } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { formatBytes } from "@/lib/drive";
import { hostOf } from "@/lib/browser/input";
import { initialOf, profileColorShades } from "@/lib/profiles";

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
export function isStartPage(url: string): boolean {
  return url === "" || url === "about:blank" || hostOf(url) === "bee.invalid";
}

export function tabTitle(tab: TabState): string {
  if (isStartPage(tab.url)) return "New tab";
  return tab.title || hostOf(tab.url) || "New tab";
}

export function TabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: readonly TabState[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex items-end gap-1 overflow-x-auto bg-surface-raised px-2 pt-2">
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
                if ((event.target as HTMLElement).closest("[data-tab-close]")) onClose(tab.id);
                else if (!selected) onActivate(tab.id);
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
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                style={{ backgroundColor: tabColor(tab.url) }}
              >
                {tab.loading ? <Spinner className="size-3 text-white" /> : initial}
              </span>
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
        {!editing && !newTab && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-9 flex items-center gap-1 truncate text-callout"
          >
            <span className="text-ink">{host}</span>
            <span className="truncate text-ink-tertiary">{shownPath}</span>
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
    </form>
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
        <MenuGroupLabel>
          {profile
            ? profile.keepData
              ? "Cookies and history are kept in this profile"
              : "This profile keeps nothing between sessions"
            : "A temporary session: nothing is kept"}
        </MenuGroupLabel>
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
  onNewTab,
  onPrint,
  onFullScreen,
  onKeyboard,
  onShortcuts,
  onEnd,
}: {
  canPrint: boolean;
  coarsePointer: boolean;
  onNewTab: () => void;
  onPrint: () => void;
  onFullScreen: () => void;
  onKeyboard: () => void;
  onShortcuts: () => void;
  onEnd: () => void;
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
        <MenuItem icon={<Plus />} onClick={onNewTab}>
          New tab
        </MenuItem>
        <MenuItem icon={<Printer />} disabled={!canPrint} onClick={onPrint}>
          Save page as PDF in Drive
        </MenuItem>
        <MenuItem icon={<Maximize2 />} onClick={onFullScreen}>
          Full screen
        </MenuItem>
        {coarsePointer ? (
          <MenuItem icon={<Keyboard />} onClick={onKeyboard}>
            Type into the page
          </MenuItem>
        ) : (
          <MenuItem icon={<Keyboard />} onClick={onShortcuts}>
            Keyboard shortcuts
          </MenuItem>
        )}
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
}: {
  region: string | null;
  engine: string;
  proxy: { name: string; protocol: string } | null;
  profile: Profile | null;
  remaining: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-surface-raised px-4 py-1.5 text-footnote text-ink-secondary">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        Cloud session{region ? ` · ${region}` : ""}
        {engine ? ` · ${engine}` : ""}
      </span>
      <span>
        {proxy ? `Proxy · ${proxy.protocol.toUpperCase()} · ${proxy.name}` : "Direct connection"}
      </span>
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
