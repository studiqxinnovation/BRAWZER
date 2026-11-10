"use client";

import {
  type BrowserEngine,
  type BrowserOverview,
  type BrowserSession,
  engineDetails,
  type Profile,
  type SavedTabs,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@brawzer/ui/components/menu";
import { useToast } from "@brawzer/ui/components/toast";
import { ChevronDown, Clock, History, Plus, X } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from "react";
import { LocalDate } from "@/components/local-date";
import { endBrowserSession, fetchBrowserOverview } from "@/lib/api/browser";
import { hostOf } from "@/lib/browser/input";
import { defaultProfile, makeProfileFor } from "@/lib/browser/launch";
import { leaveSignedInArea } from "@/lib/session-channel";
import { AppIconArt, EngineLogo } from "./engine-logo";
import "./launcher.css";

/** What to start: a profile (its own browser), a new profile for a browser, or a temporary one. */
export interface LaunchChoice {
  profileId: string | null;
  engine: BrowserEngine;
  resume: boolean;
}

type Proxies = readonly { id: string; name: string }[];

/** What opening a profile keeps, and where websites see it from, in a sentence or two. */
function describeProfile(engine: BrowserEngine, profile: Profile | null, proxies: Proxies): string {
  const details = engineDetails[engine];
  const keeps = !profile
    ? `Opens a new profile named after ${details.short} that keeps its cookies, history and sign-ins.`
    : profile.keepData
      ? `Opens “${profile.name}”: cookies, history and sign-ins are saved, encrypted, and are back next time.`
      : `Opens “${profile.name}”, which keeps nothing between sessions.`;
  const proxy = proxies.find((candidate) => candidate.id === profile?.proxyId) ?? null;
  const network = proxy
    ? `Websites see “${proxy.name}”: every connection goes through that proxy.`
    : profile?.proxyId
      ? "Websites see the profile’s proxy."
      : profile
        ? "Websites see Brawzer’s cloud; the profile has no proxy."
        : "Websites see Brawzer’s cloud.";
  return `${details.basis}. ${keeps} ${network}`;
}

/**
 * Before a browser is open, and to open another: a desktop with an icon for
 * each browser this installation offers (click to open, or choose a profile
 * from the menu under it or by right-clicking), the tabs a profile's last
 * session left to continue from, and a taskbar of the browsers running now.
 */
export function Launcher({
  profiles,
  proxies,
  overview,
  starting,
  error,
  sessionHref,
  onStart,
  onProfileCreated,
}: {
  profiles: readonly Profile[];
  /** The account's saved proxies, for saying where websites see each profile from. */
  proxies: Proxies;
  overview: BrowserOverview;
  starting: boolean;
  error: string | null;
  /** Where a running session opens (this page, or its own window). */
  sessionHref: (id: string) => string;
  onStart: (choice: LaunchChoice) => void;
  /** A profile made here for a browser, so the open browser can name it. */
  onProfileCreated: (profile: Profile) => void;
}) {
  const toast = useToast();
  // What the page loaded with, then fresh: a session may have started or ended since.
  const [live, setLive] = useState<{
    sessions: readonly BrowserSession[];
    saved: readonly SavedTabs[];
  }>({
    sessions: overview.sessions,
    saved: overview.savedTabs,
  });
  const [ending, setEnding] = useState<string | null>(null);
  const [creating, setCreating] = useState<BrowserEngine | null>(null);
  const [launching, setLaunching] = useState<BrowserEngine | null>(null);
  const [pointed, setPointed] = useState<BrowserEngine | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBrowserOverview().then((result) => {
      if (!cancelled && result.ok) {
        setLive({ sessions: result.data.sessions, saved: result.data.savedTabs });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // A start that failed leaves the icon still.
  const settled = !starting && creating === null;
  const [wasSettled, setWasSettled] = useState(settled);
  if (settled !== wasSettled) {
    setWasSettled(settled);
    if (settled && error) setLaunching(null);
  }

  const unavailable = overview.runtime === "unavailable";
  const full = live.sessions.length >= overview.limits.liveSessions;
  const busy = new Set(live.sessions.map((session) => session.profileId));
  const blocked = unavailable || full || starting || creating !== null;
  const labelOf = (session: BrowserSession) =>
    `${engineDetails[session.engine].short} · ${
      profiles.find((profile) => profile.id === session.profileId)?.name ?? "Temporary"
    }`;

  async function end(session: BrowserSession) {
    setEnding(session.id);
    const result = await endBrowserSession(session.id);
    setEnding(null);
    if (result.ok || result.status === 404) {
      setLive((current) => ({
        ...current,
        sessions: current.sessions.filter((entry) => entry.id !== session.id),
      }));
      toast.add({ type: "success", title: "Browser ended" });
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({ type: "error", title: "Couldn’t end it", description: result.error.message });
    }
  }

  /** Opens `engine` with a profile's id, a new profile ("new"), or nothing kept ("temporary"). */
  async function open(engine: BrowserEngine, target: string) {
    setLaunching(engine);
    if (target === "temporary") {
      onStart({ profileId: null, engine, resume: false });
      return;
    }
    if (target !== "new") {
      onStart({ profileId: target, engine, resume: false });
      return;
    }
    // A profile of its own for this browser: named after it, a colour not yet taken.
    setCreating(engine);
    const created = await makeProfileFor(engine, profiles);
    setCreating(null);
    if (!created.ok) {
      setLaunching(null);
      if (created.status === 401) leaveSignedInArea("expired");
      else
        toast.add({
          type: "error",
          title: "The profile wasn’t made",
          description: created.error.message,
        });
      return;
    }
    onProfileCreated(created.data);
    onStart({ profileId: created.data.id, engine, resume: false });
  }

  const caption = launching
    ? `Opening ${engineDetails[launching].short}…`
    : full
      ? `${String(live.sessions.length)} of ${String(overview.limits.liveSessions)} browsers are open. End one in the taskbar to open another.`
      : pointed
        ? describeProfile(pointed, defaultProfile(pointed, profiles, busy), proxies)
        : `Run up to ${String(overview.limits.liveSessions)} at once, say Firefox and Chrome side by side, and switch between them from the browser’s bar.`;

  return (
    <div className="bl-desktop">
      <div className="bl-main">
        <header className="bl-header">
          <h1 className="bl-title">Browser</h1>
          <p className="bl-subtitle">Only pixels reach your device — click a browser to launch</p>
        </header>

        {(unavailable || error) && (
          <div className="mx-auto mt-8 flex w-full max-w-xl flex-col gap-3">
            {unavailable && (
              <FormMessage tone="danger" title="The cloud browser isn’t available right now">
                The service that starts browsers can’t be reached. Try again in a moment.
              </FormMessage>
            )}
            {error && (
              <FormMessage tone="danger" title="The browser couldn’t start">
                {error}
              </FormMessage>
            )}
          </div>
        )}

        <ul aria-label="Browsers" className="bl-icons" data-launching={launching ?? undefined}>
          {overview.engines.map((engine, index) => (
            <li
              key={engine}
              className="bl-icon"
              style={{ animationDelay: `${String(index * 60)}ms` }}
            >
              <AppIcon
                engine={engine}
                profiles={profiles.filter((profile) => profile.engine === engine)}
                busy={busy}
                proxies={proxies}
                running={live.sessions.some((session) => session.engine === engine)}
                disabled={blocked}
                launching={launching === engine}
                onPoint={setPointed}
                onOpen={(target) => void open(engine, target)}
              />
            </li>
          ))}
        </ul>
        <p className="bl-caption" aria-live="polite">
          {caption}
        </p>

        {live.saved.length > 0 && (
          <section aria-labelledby="continue-heading" className="bl-recent">
            <h2 id="continue-heading" className="bl-section-title">
              Continue where you left off
            </h2>
            <ul aria-label="Tabs to continue from" className="bl-recent-list">
              {live.saved.map((saved) => {
                const profile = profiles.find((candidate) => candidate.id === saved.profileId);
                if (!profile) return null;
                const isOpen = busy.has(profile.id);
                return (
                  <li key={saved.profileId} className="bl-recent-card">
                    <div className="flex items-center gap-3">
                      <EngineLogo engine={profile.engine} />
                      <p className="min-w-0 text-callout text-ink">
                        <span className="font-medium">{profile.name}</span>
                        <span className="block text-footnote text-ink-secondary">
                          {saved.handedOff ? "Handed off" : "Left open"}{" "}
                          <LocalDate iso={saved.savedAt} />:{" "}
                          {saved.tabs.length === 1 ? "1 tab" : `${String(saved.tabs.length)} tabs`}
                        </span>
                      </p>
                    </div>
                    <ul
                      aria-label={`Tabs ${profile.name} reopens`}
                      className="flex flex-col gap-0.5"
                    >
                      {saved.tabs.slice(0, 3).map((tab, index) => (
                        <li
                          key={`${String(index)}:${tab.url}`}
                          className="truncate text-footnote text-ink"
                        >
                          {tab.title || hostOf(tab.url)}{" "}
                          <span className="text-ink-tertiary">· {hostOf(tab.url)}</span>
                        </li>
                      ))}
                      {saved.tabs.length > 3 && (
                        <li className="text-footnote text-ink-tertiary">
                          and {String(saved.tabs.length - 3)} more
                        </li>
                      )}
                    </ul>
                    <div className="mt-auto">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={blocked || isOpen}
                        onClick={() => {
                          setLaunching(profile.engine);
                          onStart({ profileId: profile.id, engine: profile.engine, resume: true });
                        }}
                      >
                        <History aria-hidden="true" />
                        {saved.tabs.length === 1
                          ? "Continue with 1 tab"
                          : `Continue with ${String(saved.tabs.length)} tabs`}
                        <span className="sr-only"> in {profile.name}</span>
                      </Button>
                      {isOpen && (
                        <p className="mt-2 text-footnote text-ink-secondary">
                          “{profile.name}” is open now.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <nav aria-label="Taskbar" className="bl-taskbar">
        {live.sessions.length > 0 ? (
          <ul aria-label="Browsers open now" className="bl-tasks">
            {live.sessions.map((session) => {
              const label = labelOf(session);
              return (
                <li key={session.id} className="bl-task">
                  <Link href={sessionHref(session.id) as never} className="bl-task-open">
                    <EngineLogo engine={session.engine} size="sm" />
                    <span className="truncate">{label}</span>
                    <span className="bl-task-since">
                      since <LocalDate iso={session.createdAt} />
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="bl-task-end"
                    aria-label={`End ${label}`}
                    disabled={ending === session.id}
                    onClick={() => void end(session)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bl-tasks-empty">No browsers open</p>
        )}
        <p className="bl-tray">
          {String(live.sessions.length)} of {String(overview.limits.liveSessions)} open · each ends
          after {String(overview.limits.idleMinutes)} idle minutes
        </p>
      </nav>
    </div>
  );
}

/** Arrow keys move between the desktop's icons, as on a computer's desktop. */
function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const icons = [
    ...(event.currentTarget
      .closest(".bl-icons")
      ?.querySelectorAll<HTMLButtonElement>("button.bl-app-button") ?? []),
  ];
  const index = icons.indexOf(event.currentTarget);
  if (index === -1) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? icons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + icons.length) % icons.length;
  icons[next]?.focus();
}

/** One browser on the desktop: its icon (click to open), and the profiles to open it with. */
function AppIcon({
  engine,
  profiles,
  busy,
  proxies,
  running,
  disabled,
  launching,
  onPoint,
  onOpen,
}: {
  engine: BrowserEngine;
  profiles: readonly Profile[];
  busy: ReadonlySet<string | null>;
  proxies: Proxies;
  running: boolean;
  disabled: boolean;
  launching: boolean;
  onPoint: (engine: BrowserEngine | null) => void;
  onOpen: (target: string) => void;
}) {
  const details = engineDetails[engine];
  const descriptionId = useId();
  const chosen = defaultProfile(engine, profiles, busy);
  const point = () => {
    onPoint(engine);
  };
  const leave = () => {
    onPoint(null);
  };

  const items: ReactNode = (
    <>
      {profiles.length > 0 && (
        <>
          <MenuGroup>
            <MenuGroupLabel>Open {details.short} with</MenuGroupLabel>
            {profiles.map((profile) => (
              <MenuItem
                key={profile.id}
                disabled={busy.has(profile.id)}
                onClick={() => {
                  onOpen(profile.id);
                }}
              >
                {profile.name}
                {busy.has(profile.id) ? " (open now)" : ""}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
        </>
      )}
      <MenuItem
        icon={<Plus />}
        onClick={() => {
          onOpen("new");
        }}
      >
        A new {details.short} profile
      </MenuItem>
      <MenuItem
        icon={<Clock />}
        onClick={() => {
          onOpen("temporary");
        }}
      >
        Temporary (nothing kept)
      </MenuItem>
    </>
  );

  return (
    <ContextMenu disabled={disabled}>
      <ContextMenuTrigger
        className="bl-app"
        data-running={running || undefined}
        data-launching={launching || undefined}
        onMouseEnter={point}
        onMouseLeave={leave}
      >
        <button
          type="button"
          className="bl-app-button"
          aria-label={`Open ${details.short}`}
          aria-describedby={descriptionId}
          disabled={disabled}
          onFocus={point}
          onBlur={leave}
          onKeyDown={moveFocus}
          onClick={() => {
            onOpen(chosen ? chosen.id : "new");
          }}
        >
          <AppIconArt engine={engine} />
          <span className="bl-label">{details.short}</span>
        </button>
        <span className="bl-running" aria-hidden="true" />
        <Menu>
          <MenuTrigger disabled={disabled} className="bl-profile" onFocus={point} onBlur={leave}>
            {/* Named as shown, then what it does: voice control says what it sees. */}
            <span className="truncate">{chosen ? chosen.name : "New profile"}</span>
            <span className="sr-only">, or open {details.short} with another profile</span>
            <ChevronDown aria-hidden="true" />
          </MenuTrigger>
          <MenuContent align="center">{items}</MenuContent>
        </Menu>
        <span id={descriptionId} hidden>
          {describeProfile(engine, chosen, proxies)}
          {running ? ` ${details.short} is open now.` : ""}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>{items}</ContextMenuContent>
    </ContextMenu>
  );
}
