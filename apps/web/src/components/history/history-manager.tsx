"use client";

import type { Bookmark, HistoryPage, Profile } from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import { EmptyState } from "@brawzer/ui/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Switch } from "@brawzer/ui/components/switch";
import { useToast } from "@brawzer/ui/components/toast";
import { Bookmark as BookmarkIcon, Clock, Search } from "lucide-react";
import Link from "next/link";
import { type SubmitEvent, useState } from "react";
import { Panel, SectionHeading } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import {
  clearHistory,
  fetchHistory,
  forgetHistoryEntry,
  removeBookmark,
  renameBookmark,
} from "@/lib/api/history";
import { updateProfile } from "@/lib/api/profiles";
import { displayUrl } from "@/lib/browser/input";
import { leaveSignedInArea } from "@/lib/session-channel";

/** A profile's history and bookmarks (ADR 0020): search, forget, rename, remove. */
export function HistoryManager({
  profile,
  initialHistory,
  initialBookmarks,
}: {
  profile: Profile;
  initialHistory: HistoryPage;
  initialBookmarks: readonly Bookmark[];
}) {
  const toast = useToast();
  const [history, setHistory] = useState(initialHistory);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>(initialBookmarks);
  const [renaming, setRenaming] = useState<Bookmark | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function failed(result: { status: number; error: { message: string } }, title: string) {
    if (result.status === 401) leaveSignedInArea("expired");
    else toast.add({ type: "error", title, description: result.error.message });
  }

  async function load(q: string, cursor?: string) {
    setBusy(cursor ? "more" : "search");
    const result = await fetchHistory(profile.id, { q, ...(cursor ? { cursor } : {}) });
    setBusy(null);
    if (!result.ok) {
      failed(result, "The history couldn’t be loaded");
      return;
    }
    setSearched(q);
    setHistory((current) =>
      cursor
        ? { ...result.data, entries: [...current.entries, ...result.data.entries] }
        : result.data,
    );
  }

  async function toggle(keep: boolean) {
    setBusy("toggle");
    const result = await updateProfile(profile.id, { keepHistory: keep });
    setBusy(null);
    if (!result.ok) {
      failed(result, "The setting wasn’t changed");
      return;
    }
    setHistory((current) => ({
      ...current,
      keepHistory: keep,
      recording: keep && result.data.keepData,
    }));
    toast.add({
      type: "success",
      title: keep ? "History is kept again" : "History is no longer recorded",
    });
  }

  async function forget(id: string, title: string) {
    setBusy(`forget-${id}`);
    const result = await forgetHistoryEntry(profile.id, id);
    setBusy(null);
    if (!result.ok) {
      failed(result, "That page wasn’t forgotten");
      return;
    }
    setHistory((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== id),
    }));
    toast.add({ type: "success", title: `Forgot “${title}”` });
  }

  async function clear() {
    setBusy("clear");
    const result = await clearHistory(profile.id);
    setBusy(null);
    if (!result.ok) {
      failed(result, "The history wasn’t cleared");
      return;
    }
    setHistory((current) => ({ ...current, entries: [], next: null }));
    toast.add({ type: "success", title: `Cleared the history of “${profile.name}”` });
  }

  async function remove(bookmark: Bookmark) {
    setBusy(`remove-${bookmark.id}`);
    const result = await removeBookmark(profile.id, bookmark.id);
    setBusy(null);
    if (!result.ok) {
      failed(result, "The bookmark wasn’t removed");
      return;
    }
    setBookmarks((current) => current.filter((entry) => entry.id !== bookmark.id));
    toast.add({ type: "success", title: "Bookmark removed" });
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query.trim());
  }

  return (
    <div className="flex flex-col gap-10">
      <p className="text-callout text-ink-secondary">
        <Link href="/app/profiles" className="text-accent-ink underline">
          Profiles
        </Link>{" "}
        / {profile.name}
      </p>

      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <SectionHeading id="history-heading">History</SectionHeading>
        <Panel className="flex flex-col gap-3 p-5">
          <label className="flex items-center justify-between gap-4 text-callout text-ink">
            <span>
              Keep a searchable history for “{profile.name}”
              <span className="block text-footnote text-ink-secondary">
                {!profile.keepData
                  ? "This profile starts every session clean, so nothing is recorded whatever this says."
                  : history.keepHistory
                    ? "Pages are recorded as they finish loading. Pages not visited for 90 days are forgotten."
                    : "Nothing new is recorded. What’s here stays until you forget it."}
              </span>
            </span>
            <Switch
              checked={history.keepHistory}
              disabled={busy === "toggle"}
              onCheckedChange={(checked) => void toggle(checked)}
            />
          </label>
        </Panel>
        <form method="post" role="search" onSubmit={submit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-tertiary"
            />
            <Input
              name="q"
              type="search"
              aria-label="Search the history"
              placeholder="Search the history"
              value={query}
              maxLength={200}
              autoComplete="off"
              className="pl-9"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <Button type="submit" variant="secondary" loading={busy === "search"}>
            Search
          </Button>
        </form>
        {history.entries.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Clock />}
              title={searched ? "Nothing found" : "No history"}
              description={
                searched
                  ? "Search looks at addresses and page titles."
                  : "Pages this profile’s sessions visit appear here."
              }
            />
          </Panel>
        ) : (
          <Panel>
            <ul aria-label="History" className="divide-y divide-line">
              {history.entries.map((entry) => {
                const title = entry.title || displayUrl(entry.url);
                return (
                  <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-callout text-ink">{title}</p>
                      <p className="truncate text-footnote text-ink-secondary">
                        {displayUrl(entry.url)} · <LocalDate iso={entry.lastVisitedAt} />
                        {entry.visits > 1 ? ` · ${String(entry.visits)} visits` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `forget-${entry.id}`}
                      onClick={() => void forget(entry.id, title)}
                    >
                      Forget<span className="sr-only"> {title}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
        <div className="flex flex-wrap gap-2">
          {history.next && (
            <Button
              variant="secondary"
              loading={busy === "more"}
              onClick={() => void load(searched, history.next ?? undefined)}
            >
              Show more
            </Button>
          )}
          {history.entries.length > 0 && !searched && (
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="secondary" />}>
                Clear history
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Clear the history of “{profile.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every page in it is forgotten, and so are the tabs its last session left open.
                  Bookmarks stay. Cookies and sign-ins are cleared separately, with “Clear data” on
                  the Profiles page.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="secondary" />}>
                    Keep it
                  </AlertDialogClose>
                  <AlertDialogClose
                    render={
                      <Button
                        variant="danger"
                        loading={busy === "clear"}
                        onClick={() => void clear()}
                      />
                    }
                  >
                    Clear history
                  </AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </section>

      <section aria-labelledby="bookmarks-heading" className="flex flex-col gap-4">
        <SectionHeading id="bookmarks-heading">Bookmarks</SectionHeading>
        {bookmarks.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<BookmarkIcon />}
              title="No bookmarks"
              description="Bookmark a page with the star in the cloud browser’s address bar."
            />
          </Panel>
        ) : (
          <Panel>
            <ul aria-label="Bookmarks" className="divide-y divide-line">
              {bookmarks.map((bookmark) => {
                const title = bookmark.title || displayUrl(bookmark.url);
                return (
                  <li key={bookmark.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-callout text-ink">{title}</p>
                      <p className="truncate text-footnote text-ink-secondary">
                        {displayUrl(bookmark.url)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRenaming(bookmark);
                      }}
                    >
                      Rename<span className="sr-only"> {title}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `remove-${bookmark.id}`}
                      onClick={() => void remove(bookmark)}
                    >
                      Remove<span className="sr-only"> {title}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </section>

      <RenameBookmark
        bookmark={renaming}
        onClose={() => {
          setRenaming(null);
        }}
        onSave={async (title) => {
          if (!renaming) return null;
          const result = await renameBookmark(profile.id, renaming.id, title);
          if (result.ok) {
            setBookmarks((current) =>
              current.map((entry) => (entry.id === result.data.id ? result.data : entry)),
            );
            setRenaming(null);
            toast.add({ type: "success", title: "Bookmark renamed" });
            return null;
          }
          if (result.status === 401) leaveSignedInArea("expired");
          return result.error.message;
        }}
      />
    </div>
  );
}

function RenameBookmark({
  bookmark,
  onClose,
  onSave,
}: {
  bookmark: Bookmark | null;
  onClose: () => void;
  /** Null when saved; otherwise what went wrong. */
  onSave: (title: string) => Promise<string | null>;
}) {
  return (
    <Dialog
      open={bookmark !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {bookmark && <RenameForm bookmark={bookmark} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  bookmark,
  onClose,
  onSave,
}: {
  bookmark: Bookmark;
  onClose: () => void;
  onSave: (title: string) => Promise<string | null>;
}) {
  const [title, setTitle] = useState(bookmark.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim().length > 300) {
      setError("Keep the name under 300 characters.");
      return;
    }
    setPending(true);
    const problem = await onSave(title.trim());
    setPending(false);
    setError(problem);
  }

  return (
    <form method="post" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <DialogTitle>Rename bookmark</DialogTitle>
      <DialogDescription className="break-all">{displayUrl(bookmark.url)}</DialogDescription>
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input
          name="title"
          value={title}
          maxLength={300}
          autoComplete="off"
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </Field>
      {error && (
        <FormMessage tone="danger" title="The bookmark wasn’t renamed">
          {error}
        </FormMessage>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
