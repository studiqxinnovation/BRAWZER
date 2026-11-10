"use client";

import { Button } from "@brawzer/ui/components/button";
import { Kbd } from "@brawzer/ui/components/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@brawzer/ui/components/popover";
import { ArrowRight, Bell, Search } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
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
  title: string;
  when: string;
}

/** The bell: what happened lately on the account, from its security history. */
export function Notifications({
  notices,
  attention,
}: {
  notices: readonly Notice[];
  /** Something worth a look: a new device or failed sign-ins lately. */
  attention: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative size-10 rounded-xl"
            aria-label={attention ? "Notifications, something to look at" : "Notifications"}
          />
        }
      >
        <Bell aria-hidden="true" />
        {attention && (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2.5 size-2 rounded-full bg-danger-fill ring-2 ring-canvas"
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PopoverTitle className="border-b border-line px-4 py-3 text-callout font-semibold">
          Recent activity
        </PopoverTitle>
        {notices.length > 0 ? (
          <ul className="flex flex-col py-1">
            {notices.map((notice) => (
              <li key={notice.id} className="flex justify-between gap-4 px-4 py-2 text-callout">
                <span className="text-ink">{notice.title}</span>
                <span className="shrink-0 text-footnote text-ink-tertiary">{notice.when}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-callout text-ink-secondary">Nothing yet.</p>
        )}
        <Link
          href="/app/shield"
          className="flex items-center gap-1 border-t border-line px-4 py-3 text-callout font-medium text-accent-ink hover:bg-hover"
        >
          See all activity in Shield
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
