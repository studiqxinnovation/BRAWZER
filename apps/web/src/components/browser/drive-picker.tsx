"use client";

import {
  type DriveFile,
  type DriveFolder,
  type DriveSpace,
  MAX_CHOSEN_FILES,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Checkbox } from "@brawzer/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Input } from "@brawzer/ui/components/field";
import { Spinner } from "@brawzer/ui/components/spinner";
import { ChevronLeft, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchDriveOverview, listDriveFiles } from "@/lib/api/drive";
import { childFolders, describePath, formatBytes } from "@/lib/drive";

export interface ChooserRequest {
  tabId: string;
  chooserId: string;
  multiple: boolean;
  /** Where the page is, so the person knows who is asking. */
  host: string | null;
}

interface Listing {
  key: string;
  folders: DriveFolder[];
  files: DriveFile[] | null;
  error: string | null;
}

/**
 * A website in the cloud browser asked for a file: it gets one from Drive,
 * never from this computer. Folders can be opened, Drive searched, and
 * quarantined files can't be chosen.
 */
export function DrivePicker({
  request,
  onAnswer,
}: {
  request: ChooserRequest | null;
  onAnswer: (fileIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [space, setSpace] = useState<DriveSpace>("personal");
  // The person's team, whose shared Drive can be chosen from too (ADR 0019); kept between
  // listings so the switch doesn't flicker while one loads.
  const [team, setTeam] = useState<string | null>(null);
  // Listings are keyed by what they answer, so a stale one reads as loading.
  const [listing, setListing] = useState<Listing>({
    key: "",
    folders: [],
    files: null,
    error: null,
  });
  const [chosen, setChosen] = useState<string[]>([]);
  const open = request !== null;
  const searching = query.trim() !== "";
  const key = `${request?.chooserId ?? ""}:${space}:${folderId ?? ""}:${query.trim()}`;
  const current = listing.key === key ? listing : null;
  const files = current?.files ?? null;
  const error = current?.error ?? null;
  const folders = current?.folders ?? [];
  const subfolders = searching ? [] : childFolders(folders, folderId);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void Promise.all([
          fetchDriveOverview(space),
          listDriveFiles(searching ? { q: query.trim(), space } : { folderId, space }),
        ]).then(([overview, list]) => {
          if (cancelled) return;
          const failure = !overview.ok ? overview.error : !list.ok ? list.error : null;
          const teamName = overview.ok ? (overview.data.team?.name ?? null) : null;
          setTeam(teamName);
          setListing({
            key,
            folders: overview.ok ? overview.data.folders : [],
            files: list.ok ? list.data.files : null,
            error: failure?.message ?? null,
          });
        });
      },
      searching ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, folderId, space, searching, key]);

  function close(fileIds: string[]) {
    onAnswer(fileIds);
    setChosen([]);
    setQuery("");
    setFolderId(null);
    setSpace("personal");
  }

  function toggle(id: string) {
    setChosen((current) => {
      if (current.includes(id)) return current.filter((candidate) => candidate !== id);
      if (!request?.multiple) return [id];
      return current.length < MAX_CHOSEN_FILES ? [...current, id] : current;
    });
  }

  const here = folders.find((folder) => folder.id === folderId) ?? null;
  const empty = files !== null && files.length === 0 && subfolders.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close([]);
      }}
    >
      <DialogContent>
        <DialogTitle>
          {request?.host ?? "The page"} asks for {request?.multiple ? "files" : "a file"}
        </DialogTitle>
        <DialogDescription>
          Choose from Drive. Nothing on this computer is reachable from the cloud browser.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-3">
          {team && (
            <div role="group" aria-label="Which Drive" className="flex flex-wrap gap-2">
              {(
                [
                  { value: "personal", label: "My Drive" },
                  { value: "team", label: `${team}’s Drive` },
                ] as const
              ).map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={option.value === space ? "primary" : "secondary"}
                  aria-pressed={option.value === space}
                  onClick={() => {
                    setSpace(option.value);
                    setFolderId(null);
                    setChosen([]);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
          <Input
            type="search"
            name="q"
            aria-label="Search Drive"
            placeholder="Search Drive"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {!searching && (
            <div className="flex items-center gap-1 text-footnote text-ink-secondary">
              {here && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Back to the folder above"
                  onClick={() => {
                    setFolderId(here.parentId);
                  }}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
              )}
              <span className="truncate">{describePath(folders, folderId)}</span>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
            {files === null && !error && (
              <div className="flex items-center justify-center gap-2 p-6 text-footnote text-ink-secondary">
                <Spinner className="size-4" /> Loading Drive…
              </div>
            )}
            {error && <p className="p-4 text-footnote text-danger">{error}</p>}
            {empty && (
              <p className="p-4 text-footnote text-ink-secondary">
                {searching
                  ? "Nothing in Drive matches."
                  : here
                    ? "This folder is empty."
                    : "Drive is empty. Upload a file there first."}
              </p>
            )}
            {!empty && files !== null && (
              <ul aria-label="Drive files" className="divide-y divide-line">
                {subfolders.map((folder) => (
                  <li key={folder.id}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-hover"
                      onClick={() => {
                        setFolderId(folder.id);
                      }}
                    >
                      <Folder aria-hidden="true" className="size-4 shrink-0 text-ink-secondary" />
                      <span className="truncate text-callout text-ink">{folder.name}</span>
                    </button>
                  </li>
                ))}
                {files.map((file) => {
                  const blocked = file.status !== "clean";
                  return (
                    <li key={file.id}>
                      <label
                        className={
                          blocked
                            ? "flex cursor-not-allowed items-center gap-3 px-3 py-2 opacity-60"
                            : "flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover"
                        }
                      >
                        <Checkbox
                          checked={chosen.includes(file.id)}
                          disabled={blocked}
                          onCheckedChange={() => {
                            toggle(file.id);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-callout text-ink">{file.name}</span>
                          <span className="block text-caption text-ink-tertiary">
                            {blocked
                              ? "Quarantined: can’t be given to a page"
                              : searching
                                ? `${formatBytes(file.size)} · in ${describePath(folders, file.folderId)}`
                                : formatBytes(file.size)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button
            variant="secondary"
            onClick={() => {
              close([]);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={chosen.length === 0}
            onClick={() => {
              close(chosen);
            }}
          >
            {chosen.length > 1 ? `Give ${String(chosen.length)} files` : "Give to the page"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
