"use client";

import { Button } from "@brawzer/ui/components/button";
import { Kbd } from "@brawzer/ui/components/kbd";
import { ArrowRight, Bell, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { openCommandPalette } from "@/components/app-shell/command-palette";

const never = () => () => undefined;

/** Search: the "Go to" palette, with the shortcut this computer uses. */
export function SearchButton() {
  const mac = useSyncExternalStore(
    never,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-10 gap-2 rounded-xl px-3 text-ink-secondary"
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      onClick={openCommandPalette}
    >
      <Search aria-hidden="true" />
      {/* Named as shown, then what it does: the shortcut is part of the name. */}
      <span className="sr-only">Search Brawzer</span>
      <Kbd className="max-sm:hidden">{mac ? "⌘K" : "Ctrl K"}</Kbd>
    </Button>
  );
}

export interface Notice {
  id: string;
  /** Where it comes from, as a notification says: "Shield · Security". */
  source: string;
  emoji: string;
  tone: "danger" | "success" | "accent";
  title: string;
  when: string;
  /** When it happened (ISO), to tell what's new since the person last looked. */
  at: string;
}

/** When the person last looked, kept for this tab only: a shared computer keeps nothing. */
const SEEN_KEY = "brawzer:notices-seen";

function readSeen(): number {
  try {
    return Number(sessionStorage.getItem(SEEN_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Storage blocked: everything counts as new next time, which is harmless.
  }
}

/**
 * The bell, and notices that slide in from the right as a computer's do:
 * what happened lately on the account, from its security history. New ones
 * (since the person last looked) are counted on the bell and shown once on
 * arrival; each can be dismissed.
 */
export function Notifications({ notices }: { notices: readonly Notice[] }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const seenAt = useSyncExternalStore(never, readSeen, () => Number.POSITIVE_INFINITY);
  const shown = notices.filter((notice) => !dismissed.has(notice.id));
  const fresh = shown.filter((notice) => new Date(notice.at).getTime() > seenAt).length;

  // New notices arrive once, on their own, and step back after a few seconds.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !Number.isFinite(seenAt)) return;
    arrived.current = true;
    if (!notices.some((notice) => new Date(notice.at).getTime() > seenAt)) return;
    const show = setTimeout(() => {
      setOpen(true);
    }, 800);
    const hide = setTimeout(() => {
      setOpen((current) => (current ? false : current));
      markSeen();
    }, 5_500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [notices, seenAt]);

  // Escape puts them away, wherever focus is.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      markSeen();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    setOpen((current) => {
      if (current) markSeen();
      return !current;
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative size-10 rounded-xl border border-line"
        aria-label={fresh > 0 ? `Notifications, ${String(fresh)} new` : "Notifications"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <Bell aria-hidden="true" />
        {fresh > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-danger-fill text-[0.5625rem] font-bold text-white ring-2 ring-canvas"
          >
            {fresh > 9 ? "9+" : String(fresh)}
          </span>
        )}
      </Button>
      <section
        id={panelId}
        aria-label="Recent notices"
        data-open={open || undefined}
        className="hm-notices"
      >
        <ul className="flex flex-col gap-1.5">
          {shown.map((notice, index) => (
            <li
              key={notice.id}
              className="hm-notice"
              style={{ transitionDelay: open ? `${String(index * 120)}ms` : "0ms" }}
            >
              <span aria-hidden="true" className={`hm-notice-icon hm-tint-${notice.tone}`}>
                <span className="hm-emoji">{notice.emoji}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="hm-eyebrow">{notice.source}</p>
                <p className="text-callout font-semibold text-ink">{notice.title}</p>
                <p className="mt-0.5 text-caption text-ink-tertiary">{notice.when}</p>
              </div>
              <button
                type="button"
                className="hm-notice-close"
                aria-label={`Dismiss “${notice.title}”`}
                tabIndex={open ? 0 : -1}
                onClick={() => {
                  setDismissed((current) => new Set([...current, notice.id]));
                }}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
        {open && (
          <Link href="/app/shield" className="hm-notice hm-notice-more">
            {shown.length === 0 ? "Nothing new. " : ""}See all activity in Shield
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </section>
    </>
  );
}
