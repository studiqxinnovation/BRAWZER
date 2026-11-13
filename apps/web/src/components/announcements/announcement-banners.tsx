"use client";

import { type Announcement, announcementKindNames } from "@brawzer/contracts";
import { cn } from "@brawzer/ui/lib/cn";
import { Info, Megaphone, TriangleAlert, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clickAnnouncement,
  dismissAnnouncement,
  fetchAnnouncements,
} from "@/lib/api/announcements";

/** How often the banners are checked while the app is open. */
const REFRESH_MS = 5 * 60_000;

const ICONS = {
  news: Megaphone,
  incident: TriangleAlert,
  maintenance: Wrench,
  tip: Info,
} as const;

const TONES: Record<Announcement["kind"], string> = {
  news: "border-accent/30 bg-accent/10",
  incident: "border-danger/30 bg-danger/10",
  maintenance: "border-amber-500/30 bg-amber-500/10",
  tip: "border-emerald-500/30 bg-emerald-500/10",
};

/**
 * Banners Brawzer's team publishes to this account: incidents before you
 * notice them, maintenance, news. Dismissing one is remembered on the
 * account, so it stays gone on every device.
 */
export function AnnouncementBanners() {
  const [banners, setBanners] = useState<Announcement[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchAnnouncements().then((result) => {
        if (!cancelled && result.ok) setBanners(result.data.announcements);
      });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (banners.length === 0) return null;
  return (
    <section
      className="pointer-events-none fixed inset-x-0 top-9 z-40 flex flex-col items-center gap-2 px-4"
      aria-label="Announcements from Brawzer"
    >
      {banners.slice(0, 3).map((banner) => {
        const Icon = ICONS[banner.kind];
        return (
          <div
            key={banner.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-xl border px-4 py-3 text-ink shadow-md backdrop-blur",
              TONES[banner.kind],
            )}
            role="status"
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 flex-none" />
            <div className="text-sm min-w-0 flex-1">
              <p className="font-medium">
                <span className="sr-only">{announcementKindNames[banner.kind]}: </span>
                {banner.title}
              </p>
              <p className="text-ink-muted">{banner.body}</p>
              {banner.link && (
                <Link
                  href={banner.link as never}
                  className="mt-1 inline-block font-medium underline underline-offset-2"
                  onClick={() => {
                    void clickAnnouncement(banner.id);
                  }}
                >
                  Learn more
                </Link>
              )}
            </div>
            <button
              type="button"
              className="text-ink-muted rounded-md p-1 hover:text-ink"
              aria-label={`Dismiss “${banner.title}”`}
              onClick={() => {
                setBanners((current) => current.filter((entry) => entry.id !== banner.id));
                void dismissAnnouncement(banner.id);
              }}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
