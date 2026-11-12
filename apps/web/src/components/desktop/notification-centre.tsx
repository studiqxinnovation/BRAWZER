"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { GlyphTile } from "@/components/glyph-tile";
import { type Notice } from "@/components/home/header-actions";
import { sharedComputerNotice, toNotices } from "@/components/home/notices";
import { fetchSecurityEvents } from "@/lib/api/security";
import { menuBarClock, subscribeToClock } from "@/lib/clock";
import {
  defaultDesktopPrefs,
  readDesktopPrefs,
  subscribeToDesktopPrefs,
  updateDesktopPrefs,
} from "@/lib/desktop-prefs";
import {
  type AppNotification,
  clearNotifications,
  dismissNotification,
  readNotifications,
  subscribeToNotifications,
  whenLabel,
} from "@/lib/notifications";
import { playSound } from "@/lib/sounds";

/** How long a banner stays before stepping back into the centre. */
const BANNER_MS = 6_000;
const never = () => () => undefined;
const nowMinute = () => Math.floor(Date.now() / 30_000);

const usePrefs = () =>
  useSyncExternalStore(subscribeToDesktopPrefs, readDesktopPrefs, defaultDesktopPrefs);

/**
 * Banners: each new notification slides in at the top right, as a Mac's or
 * Windows' do, and steps back after a few seconds; choosing one runs its
 * action. None show while Do Not Disturb is on; they still wait in the
 * centre.
 */
export function NotificationBanners() {
  const all = useSyncExternalStore(subscribeToNotifications, readNotifications, readNotifications);
  const prefs = usePrefs();
  const [showing, setShowing] = useState<readonly string[]>([]);
  const seen = useRef(new Set<string>());
  const settings = useRef(prefs);
  useEffect(() => {
    settings.current = prefs;
  }, [prefs]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const entry of all) {
      if (seen.current.has(entry.id)) continue;
      seen.current.add(entry.id);
      if (settings.current.dnd) continue;
      setShowing((current) => [entry.id, ...current].slice(0, 4));
      if (settings.current.sounds) playSound("note");
      timers.push(
        setTimeout(() => {
          setShowing((current) => current.filter((id) => id !== entry.id));
        }, BANNER_MS),
      );
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [all]);

  const banners = showing.flatMap((id) => {
    const entry = all.find((candidate) => candidate.id === id);
    return entry ? [entry] : [];
  });
  if (banners.length === 0) return null;
  return (
    <section className="dt-banners" aria-live="polite" aria-label="New notifications">
      {banners.map((entry) => (
        <NotificationCard
          key={entry.id}
          entry={entry}
          banner
          onDismiss={() => {
            setShowing((current) => current.filter((id) => id !== entry.id));
          }}
        />
      ))}
    </section>
  );
}

function NotificationCard({
  entry,
  banner = false,
  onDismiss,
}: {
  entry: AppNotification | Notice;
  banner?: boolean;
  onDismiss: () => void;
}) {
  const minute = useSyncExternalStore(
    (listener) => {
      const timer = setInterval(listener, 30_000);
      return () => {
        clearInterval(timer);
      };
    },
    nowMinute,
    nowMinute,
  );
  const action = "action" in entry ? entry.action : undefined;
  const when = "when" in entry ? entry.when : whenLabel(entry.at, minute * 30_000);
  const body = (
    <>
      <GlyphTile glyph={entry.glyph} colour={entry.colour} size={36} />
      <div className="min-w-0 flex-1">
        <p className="dt-nc-src">{entry.source}</p>
        <p className="dt-nc-title">{entry.title}</p>
        {entry.description && <p className="dt-nc-desc">{entry.description}</p>}
        <p className="dt-nc-when">{when}</p>
      </div>
    </>
  );
  return (
    <div className="dt-nc-card" data-banner={banner || undefined} data-tone={entry.tone}>
      {action ? (
        <button
          type="button"
          className="dt-nc-body"
          onClick={() => {
            onDismiss();
            action.run();
          }}
        >
          {body}
        </button>
      ) : (
        <div className="dt-nc-body">{body}</div>
      )}
      <button
        type="button"
        className="dt-nc-x"
        aria-label={`Dismiss “${entry.title}”`}
        onClick={onDismiss}
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>
  );
}

/**
 * Notification Centre: the menu bar's clock and bell open it, as a Mac's
 * clock does. Every notification not yet dismissed, the account's latest
 * security notices, Do Not Disturb, and Clear all.
 */
export function NotificationCentre({ compact = false }: { compact?: boolean }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const all = useSyncExternalStore(subscribeToNotifications, readNotifications, readNotifications);
  const prefs = usePrefs();
  const time = useSyncExternalStore(subscribeToClock, menuBarClock, () => "");
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [seenCount, setSeenCount] = useState(0);
  const fresh = Math.max(0, all.length - seenCount);
  const mac = useSyncExternalStore(
    never,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchSecurityEvents(3).then((result) => {
      if (cancelled || !result.ok) return;
      const now = Date.now();
      const shared = document.documentElement.dataset.sessionKeeper === "shared";
      setNotices([
        ...(shared ? [sharedComputerNotice(new Date(now).toISOString())] : []),
        ...toNotices(result.data.events, now),
      ]);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(`[data-nc-root="${panelId}"]`)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, all.length, panelId]);

  const shownNotices = notices.filter((notice) => !hidden.has(notice.id));
  const empty = all.length === 0 && shownNotices.length === 0;
  const toggle = () => {
    setSeenCount(all.length);
    setOpen((current) => !current);
  };
  return (
    <div className="dt-nc-root" data-nc-root={panelId}>
      {compact ? (
        <button
          type="button"
          className="ad-mb-b relative"
          aria-label={fresh > 0 ? `Notifications, ${String(fresh)} new` : "Notifications"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <Bell aria-hidden="true" className="size-[15px]" />
          {fresh > 0 && <span aria-hidden="true" className="dt-nc-dot" />}
        </button>
      ) : null}
      <button
        type="button"
        className="ad-mb-clock-b"
        aria-label={`${time}. Notification Centre${fresh > 0 ? `, ${String(fresh)} new` : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <time className="ad-mb-clock">{time}</time>
      </button>
      <section
        id={panelId}
        aria-label="Notification Centre"
        className="dt-nc"
        data-open={open || undefined}
        hidden={!open}
      >
        <header className="dt-nc-head">
          <h2 className="dt-nc-h">Notification Centre</h2>
          <label className="dt-nc-dnd">
            <input
              type="checkbox"
              checked={prefs.dnd}
              onChange={() => {
                updateDesktopPrefs({ dnd: !prefs.dnd });
              }}
            />
            Do Not Disturb
          </label>
        </header>
        {empty ? (
          <p className="dt-nc-empty">
            Nothing new. Downloads, timers and uploads will tell you here
            {mac ? ", and the clock opens this." : "."}
          </p>
        ) : (
          <div className="dt-nc-list">
            {all.map((entry) => (
              <NotificationCard
                key={entry.id}
                entry={entry}
                onDismiss={() => {
                  dismissNotification(entry.id);
                }}
              />
            ))}
            {shownNotices.length > 0 && <p className="dt-nc-group">From Shield</p>}
            {shownNotices.map((notice) => (
              <NotificationCard
                key={notice.id}
                entry={notice}
                onDismiss={() => {
                  setHidden((current) => new Set([...current, notice.id]));
                }}
              />
            ))}
          </div>
        )}
        {!empty && (
          <footer className="dt-nc-foot">
            <button
              type="button"
              className="dt-nc-clear"
              onClick={() => {
                clearNotifications();
                setHidden(new Set(notices.map((notice) => notice.id)));
              }}
            >
              Clear all
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
