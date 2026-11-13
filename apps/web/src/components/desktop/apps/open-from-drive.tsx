"use client";

import type { DriveFile, DriveFileKind } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { FileText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { listDriveFiles } from "@/lib/api/drive";

/** Picks a file of these kinds from anywhere in Drive, found by typing. */
export function OpenFromDrive({
  open,
  onOpenChange,
  kind,
  accept,
  title,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: DriveFileKind | readonly DriveFileKind[];
  /** Only names ending like these, such as [".csv"]; none: every file of the kind. */
  accept?: readonly string[];
  title: string;
  onChoose: (file: DriveFile) => void;
}) {
  const [files, setFiles] = useState<readonly DriveFile[] | null>(null);
  const [query, setQuery] = useState("");

  const kinds = typeof kind === "string" ? kind : kind.join(",");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all(
      kinds.split(",").map((one) => listDriveFiles({ kind: one as DriveFileKind })),
    ).then((results) => {
      if (cancelled) return;
      const found = results.flatMap((result) => (result.ok ? result.data.files : []));
      setFiles(found.sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, kinds]);

  const shown = (files ?? []).filter(
    (file) =>
      (!accept || accept.some((ending) => file.name.toLowerCase().endsWith(ending))) &&
      file.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Files in your Drive.</DialogDescription>
        <label className="ap-search mt-4">
          <Search aria-hidden="true" />
          <span className="sr-only">Search Drive</span>
          <input
            type="search"
            value={query}
            placeholder="Search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <ul className="ap-pick-list" aria-label="Files">
          {files === null ? (
            <li className="ap-pick-none">Looking…</li>
          ) : shown.length === 0 ? (
            <li className="ap-pick-none">Nothing to open here yet.</li>
          ) : (
            shown.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  className="ap-pick"
                  onClick={() => {
                    onOpenChange(false);
                    onChoose(file);
                  }}
                >
                  <FileText aria-hidden="true" />
                  <span>{file.name}</span>
                  <span>{new Date(file.updatedAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
