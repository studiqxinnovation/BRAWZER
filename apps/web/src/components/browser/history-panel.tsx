"use client";

import type { Bookmark, HistoryEntry } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@brawzer/ui/components/sheet";
import { Spinner } from "@brawzer/ui/components/spinner";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchHistory } from "@/lib/api/history";
import { displayUrl } from "@/lib/browser/input";

/**
 * The session profile's bookmarks and history, from the "…" menu (ADR
 * 0020). Choosing one opens it in the current tab, in the cloud.
 */
export function HistoryPanel({
  open,
  onOpenChange,
  profile,
  bookmarks,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: { id: string; name: string };
  bookmarks: readonly Bookmark[];
  onOpen: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  // Results are keyed by what they answer, so a stale one reads as loading.
  const [result, setResult] = useState<{
    key: string;
    entries: HistoryEntry[] | null;
    recording: boolean;
    error: string | null;
  }>({ key: "", entries: null, recording: true, error: null });
  const needle = query.trim();
  const key = open ? `${profile.id}:${needle}` : "";
  const current = result.key === key ? result : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void fetchHistory(profile.id, needle ? { q: needle } : {}).then((answer) => {
          if (cancelled) return;
          setResult({
            key,
            entries: answer.ok ? answer.data.entries.slice(0, 50) : null,
            recording: answer.ok ? answer.data.recording : true,
            error: answer.ok ? null : answer.error.message,
          });
        });
      },
      needle ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, profile.id, needle, key]);

  const lowered = needle.toLowerCase();
  const shownBookmarks = bookmarks.filter(
    (bookmark) =>
      !lowered ||
      bookmark.url.toLowerCase().includes(lowered) ||
      bookmark.title.toLowerCase().includes(lowered),
  );

  function choose(url: string) {
    onOpen(url);
    onOpenChange(false);
  }

  return (
    <Sheet side="right" open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(24rem,calc(100vw-3rem))]">
        <SheetTitle>History and bookmarks</SheetTitle>
        <SheetDescription>“{profile.name}”, across every session.</SheetDescription>
        <Input
          type="search"
          name="q"
          aria-label="Search history and bookmarks"
          placeholder="Search"
          autoComplete="off"
          className="mt-4"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <h3 className="mt-5 text-footnote font-medium text-ink-secondary">Bookmarks</h3>
        {shownBookmarks.length === 0 ? (
          <p className="mt-1 text-footnote text-ink-tertiary">
            {needle ? "No bookmark matches." : "None yet: use the star beside the address."}
          </p>
        ) : (
          <ul aria-label="Bookmarks" className="mt-1 flex flex-col">
            {shownBookmarks.map((bookmark) => (
              <li key={bookmark.id}>
                <PageButton
                  title={bookmark.title}
                  url={bookmark.url}
                  onClick={() => {
                    choose(bookmark.url);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-5 text-footnote font-medium text-ink-secondary">History</h3>
        {current?.error && (
          <FormMessage tone="danger" title="The history can’t be loaded">
            {current.error}
          </FormMessage>
        )}
        {!current && (
          <p
            role="status"
            className="mt-2 flex items-center gap-2 text-footnote text-ink-secondary"
          >
            <Spinner className="size-4" /> Loading…
          </p>
        )}
        {current?.entries?.length === 0 && (
          <p className="mt-1 text-footnote text-ink-tertiary">
            {needle
              ? "No page matches."
              : current.recording
                ? "Pages you visit appear here."
                : "This profile doesn’t keep a history."}
          </p>
        )}
        {current?.entries && current.entries.length > 0 && (
          <ul aria-label="History" className="mt-1 flex flex-col">
            {current.entries.map((entry) => (
              <li key={entry.id}>
                <PageButton
                  title={entry.title}
                  url={entry.url}
                  onClick={() => {
                    choose(entry.url);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto pt-5">
          <Button
            variant="secondary"
            size="sm"
            render={<Link href={`/app/profiles/${profile.id}/history`} />}
          >
            Manage history and bookmarks
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PageButton({ title, url, onClick }: { title: string; url: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="truncate text-callout text-ink">{title || displayUrl(url)}</span>
      <span className="truncate text-footnote text-ink-secondary">{displayUrl(url)}</span>
    </button>
  );
}
