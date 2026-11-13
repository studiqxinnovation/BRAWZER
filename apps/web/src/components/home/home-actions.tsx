"use client";

import { Button } from "@brawzer/ui/components/button";
import { Play } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { desktopActive, subscribeToDesktop } from "@/lib/desktop";
import { type Notice, Notifications, SearchButton } from "./header-actions";

/**
 * Home's search, bell and Start browsing. On the desktop they're in the
 * dashboard window's title bar instead, as the prototype puts them, so
 * here they show only in the classic layout and on phones.
 */
export function HomeActions({ notices }: { notices: readonly Notice[] }) {
  const onDesktop = useSyncExternalStore(subscribeToDesktop, desktopActive, () => false);
  if (onDesktop) return null;
  return (
    <div className="ad-home-actions flex items-center gap-1.5">
      <SearchButton />
      <Notifications notices={notices} />
      <Button
        variant="primary"
        className="ml-1.5 h-10 rounded-xl px-4 shadow-[0_0_16px_color-mix(in_oklab,var(--color-accent)_45%,transparent)] hover:-translate-y-px"
        render={<Link href="/app/browser" />}
      >
        <Play aria-hidden="true" className="fill-current" />
        Start browsing
      </Button>
    </div>
  );
}
