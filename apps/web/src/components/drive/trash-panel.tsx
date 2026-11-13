"use client";

import { DRIVE_TRASH_DAYS, type DriveFile, type DriveSpace } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteForever, emptyTrash, fetchTrash, restoreFile } from "@/lib/api/drive";

/**
 * Drive's Trash on the Drive page: deleted files, kept DRIVE_TRASH_DAYS to
 * put back or remove for good. Read when it's opened.
 */
export function TrashPanel({ space }: { space: DriveSpace }) {
  const toast = useToast();
  const router = useRouter();
  const [files, setFiles] = useState<readonly DriveFile[] | null>(null);

  async function load() {
    const result = await fetchTrash(space);
    setFiles(result.ok ? result.data.files : []);
  }

  async function act(run: () => Promise<{ ok: boolean }>, done: string) {
    const result = await run();
    if (result.ok) toast.add({ type: "success", title: done });
    else toast.add({ type: "error", title: "That didn’t work", description: "Try again." });
    await load();
    router.refresh();
  }

  return (
    <details
      className="group rounded-xl border border-line bg-surface"
      onToggle={(event) => {
        if (event.currentTarget.open && files === null) void load();
      }}
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-callout font-semibold text-ink">
        Trash
        <span className="text-footnote font-normal text-ink-secondary">
          Kept {DRIVE_TRASH_DAYS} days, then removed
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        {files === null ? (
          <p className="text-callout text-ink-secondary">Looking…</p>
        ) : files.length === 0 ? (
          <p className="text-callout text-ink-secondary">Trash is empty.</p>
        ) : (
          <>
            <ul aria-label="In Trash" className="flex flex-col divide-y divide-line">
              {files.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-callout text-ink">{file.name}</span>
                  <Button
                    size="sm"
                    onClick={() => void act(() => restoreFile(file.id), `“${file.name}” is back`)}
                  >
                    Put back
                  </Button>
                  {file.canDelete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(() => deleteForever(file.id), `“${file.name}” deleted for good`)
                      }
                    >
                      Delete for good
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                variant="danger"
                onClick={() => void act(() => emptyTrash(space), "Trash emptied")}
              >
                Empty Trash
              </Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
