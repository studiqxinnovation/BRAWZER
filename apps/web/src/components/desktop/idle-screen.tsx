"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "@brawzer/ui/brand";
import { lockClock, subscribeToClock } from "@/lib/clock";
import { imageWallpapers, wallpaperEntry, wallpaperUrl } from "@/lib/desktop";
import {
  defaultDesktopPrefs,
  readDesktopPrefs,
  subscribeToDesktopPrefs,
} from "@/lib/desktop-prefs";
import { isLocked, lockNow, subscribeToLock } from "@/lib/lock";
import { onSessionMessage } from "@/lib/session-channel";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
/** How often the idle clock is read. */
const TICK_MS = 1_000;
/** How long each picture stays in the screen saver. */
const SLIDE_MS = 12_000;

export type IdlePhase = "awake" | "dim" | "saver";

/**
 * What a computer does when nobody is using it: the screen dims, then a
 * screen saver (the wallpaper photographs, drifting, with the clock), then
 * the lock. Each after the minutes chosen in Settings, counted from the
 * last pointer, key or touch in any Brawzer tab; any of those wakes it.
 * The lock is the server's (as Lock screen is); this only asks for it.
 */
export function IdleScreen({
  active,
  saverNow,
  onSaverShown,
}: {
  /** Whether the desktop is in use (not on a phone, not switched off). */
  active: boolean;
  /** Asks for the screen saver now (Settings' "Start screen saver"). */
  saverNow: number;
  onSaverShown?: () => void;
}) {
  const prefs = useSyncExternalStore(
    subscribeToDesktopPrefs,
    readDesktopPrefs,
    defaultDesktopPrefs,
  );
  const locked = useSyncExternalStore(subscribeToLock, isLocked, () => false);
  const [phase, setPhase] = useState<IdlePhase>("awake");
  const settings = useRef(prefs);
  useEffect(() => {
    settings.current = prefs;
  }, [prefs]);
  const forced = useRef(false);
  /** The idle clock's own check, so "Start now" needn't wait for the next second. */
  const tickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!active) return;
    let lastActivity = Date.now();
    let lockedAt: number | null = null;
    const wake = () => {
      lastActivity = Date.now();
      lockedAt = null;
      forced.current = false;
      setPhase((current) => (current === "awake" ? current : "awake"));
    };
    const onActivity = () => {
      if (isLocked()) return;
      wake();
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { passive: true, capture: true });
    }
    // Use in another Brawzer tab counts: the screen saver shouldn't start while someone types next door.
    const stopListening = onSessionMessage((message) => {
      if (message.type === "activity" && !isLocked()) {
        lastActivity = Math.max(lastActivity, message.at);
        forced.current = false;
        setPhase((current) => (current === "awake" ? current : "awake"));
      }
    });
    const tick = () => {
      if (isLocked()) {
        // While locked the lock screen is what shows; nothing to dim.
        setPhase("awake");
        return;
      }
      const { dimAfter, saverAfter, lockAfter } = settings.current;
      const idleMs = Date.now() - lastActivity;
      const minutes = idleMs / 60_000;
      if (forced.current) {
        setPhase("saver");
      } else if (saverAfter > 0 && minutes >= saverAfter) {
        setPhase("saver");
      } else if (dimAfter > 0 && minutes >= dimAfter) {
        setPhase("dim");
      } else {
        setPhase("awake");
      }
      if (lockAfter > 0 && minutes >= lockAfter && lockedAt === null) {
        lockedAt = Date.now();
        void lockNow();
      }
    };
    tickRef.current = tick;
    const timer = setInterval(tick, TICK_MS);
    return () => {
      tickRef.current = () => undefined;
      clearInterval(timer);
      stopListening();
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
    };
  }, [active]);

  // Settings' "Start screen saver": on at once, until the next touch.
  useEffect(() => {
    if (saverNow === 0 || !active) return;
    forced.current = true;
    tickRef.current();
    onSaverShown?.();
  }, [saverNow, active, onSaverShown]);

  useEffect(() => {
    document.documentElement.dataset.idle = phase === "awake" || locked ? "" : phase;
    if (phase === "awake" || locked) delete document.documentElement.dataset.idle;
  }, [phase, locked]);

  if (!active || locked || phase === "awake") return null;
  return phase === "dim" ? (
    <div className="dt-dim" aria-hidden="true" data-testid="screen-dim" />
  ) : (
    <ScreenSaver />
  );
}

/** The wallpaper photographs one after another, drifting slowly, under the clock. */
function ScreenSaver() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * imageWallpapers.length));
  const [time, date] = useSyncExternalStore(subscribeToClock, lockClock, () => "|").split("|");
  const still = useSyncExternalStore(
    () => () => undefined,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % imageWallpapers.length);
    }, SLIDE_MS);
    return () => {
      clearInterval(timer);
    };
  }, [still]);
  const key = imageWallpapers[index] ?? imageWallpapers[0];
  if (!key) return null;
  const credit = wallpaperEntry(key).credit;
  return (
    <div className="dt-saver" role="img" aria-label="Screen saver" data-testid="screen-saver">
      <div
        key={key}
        className="dt-saver-photo"
        data-still={still || undefined}
        style={{ backgroundImage: `url(${wallpaperUrl(key)})` }}
      />
      <div className="dt-saver-clock">
        <span className="dt-saver-time">{time}</span>
        <span className="dt-saver-date">{date}</span>
      </div>
      <div className="dt-saver-foot">
        <Logo size={18} className="text-white/80" />
        <span>
          {credit ? `${wallpaperEntry(key).name} · ${credit.by}` : wallpaperEntry(key).name}
        </span>
        <span className="dt-saver-hint">Move the mouse or press a key</span>
      </div>
    </div>
  );
}
