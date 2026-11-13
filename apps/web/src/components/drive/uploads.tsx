"use client";

import type { DriveSpace, DriveUsage } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { CircleAlert, CircleCheck, ShieldAlert, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { type UploadHandle, uploadDriveFile } from "@/lib/api/drive";
import { formatBytes, shortName } from "@/lib/drive";
import { leaveSignedInArea } from "@/lib/session-channel";

interface UploadState {
  id: number;
  name: string;
  size: number;
  fraction: number;
  status: "uploading" | "scanning" | "done" | "quarantined" | "failed";
  message?: string;
  handle?: UploadHandle;
}

let nextId = 1;

/** Tracks the files being uploaded from this page. */
export function useUploads(
  folderId: string | null,
  usage: DriveUsage,
  space: DriveSpace = "personal",
) {
  const router = useRouter();
  const toast = useToast();
  const [uploads, setUploads] = useState<UploadState[]>([]);

  const patch = useCallback((id: number, change: Partial<UploadState>) => {
    setUploads((current) =>
      current.map((upload) => (upload.id === id ? { ...upload, ...change } : upload)),
    );
  }, []);

  const start = useCallback(
    (files: readonly File[]) => {
      for (const file of files) {
        const id = nextId++;
        if (file.size > usage.maxFileBytes) {
          setUploads((current) => [
            ...current,
            {
              id,
              name: file.name,
              size: file.size,
              fraction: 0,
              status: "failed",
              message: `Files can be up to ${formatBytes(usage.maxFileBytes)} while Brawzer is in development.`,
            },
          ]);
          continue;
        }
        const handle = uploadDriveFile(
          file,
          folderId,
          (fraction) => {
            patch(id, { fraction, status: fraction >= 1 ? "scanning" : "uploading" });
          },
          space,
        );
        setUploads((current) => [
          ...current,
          { id, name: file.name, size: file.size, fraction: 0, status: "uploading", handle },
        ]);
        void handle.result.then((result) => {
          if (result.ok) {
            patch(id, {
              fraction: 1,
              status: result.data.status === "infected" ? "quarantined" : "done",
              message:
                result.data.status === "infected"
                  ? `Quarantined: the scan found ${result.data.threat ?? "malware"}.`
                  : undefined,
            });
            if (result.data.status === "infected") {
              toast.add({
                type: "error",
                title: `“${shortName(result.data.name)}” was quarantined`,
                description: "The malware scan found a threat. The file can only be deleted.",
              });
            }
            router.refresh();
            return;
          }
          if (result.status === 401) {
            leaveSignedInArea("expired");
            return;
          }
          patch(id, { status: "failed", message: result.error.message });
        });
      }
    },
    [folderId, patch, router, space, toast, usage.maxFileBytes],
  );

  const dismiss = useCallback((id: number) => {
    setUploads((current) => {
      const upload = current.find((entry) => entry.id === id);
      if (upload?.status === "uploading" || upload?.status === "scanning") upload.handle?.abort();
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  const clearFinished = useCallback(() => {
    setUploads((current) =>
      current.filter((upload) => upload.status === "uploading" || upload.status === "scanning"),
    );
  }, []);

  return { uploads, start, dismiss, clearFinished };
}

/** Opens the file picker; the browser's own dialog does the choosing. */
export function UploadButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: readonly File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="drive-file-input"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <Button variant="primary" disabled={disabled} onClick={() => input.current?.click()}>
        <Upload aria-hidden="true" />
        Upload
      </Button>
    </>
  );
}

const statusLabel: Record<UploadState["status"], string> = {
  uploading: "Uploading",
  scanning: "Scanning for malware",
  done: "Added to Drive",
  quarantined: "Quarantined",
  failed: "Not uploaded",
};

/** The uploads in progress and the ones just finished, with their outcome. */
export function UploadList({
  uploads,
  onDismiss,
  onClearFinished,
}: {
  uploads: readonly UploadState[];
  onDismiss: (id: number) => void;
  onClearFinished: () => void;
}) {
  if (uploads.length === 0) return null;
  const finished = uploads.filter(
    (upload) => upload.status !== "uploading" && upload.status !== "scanning",
  );
  return (
    <section
      aria-labelledby="drive-uploads-heading"
      aria-live="polite"
      className="rounded-xl border border-line bg-surface"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <h2 id="drive-uploads-heading" className="text-callout font-medium text-ink">
          Uploads
        </h2>
        {finished.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearFinished}>
            Clear finished
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {uploads.map((upload) => {
          const percent = Math.round(upload.fraction * 100);
          const active = upload.status === "uploading" || upload.status === "scanning";
          return (
            <li key={upload.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <div className="mt-0.5 shrink-0 text-ink-secondary [&_svg]:size-4">
                {upload.status === "done" && <CircleCheck className="text-success" aria-hidden />}
                {upload.status === "quarantined" && (
                  <ShieldAlert className="text-danger" aria-hidden />
                )}
                {upload.status === "failed" && <CircleAlert className="text-danger" aria-hidden />}
                {active && <Upload aria-hidden />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-callout font-medium text-ink">{upload.name}</p>
                <p className="text-footnote text-ink-secondary">
                  {statusLabel[upload.status]}
                  {upload.status === "uploading" && ` · ${String(percent)}%`}
                  {" · "}
                  {formatBytes(upload.size)}
                </p>
                {upload.message && (
                  <p
                    className={
                      upload.status === "done"
                        ? "text-footnote text-ink-secondary"
                        : "text-footnote text-danger"
                    }
                  >
                    {upload.message}
                  </p>
                )}
                {active && (
                  <div
                    role="progressbar"
                    aria-label={`Uploading ${upload.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hover"
                  >
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-(--bw-duration-fast) ease-standard"
                      style={{ width: `${String(percent)}%` }}
                    />
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${active ? "Cancel" : "Dismiss"} ${upload.name}`}
                onClick={() => {
                  onDismiss(upload.id);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
