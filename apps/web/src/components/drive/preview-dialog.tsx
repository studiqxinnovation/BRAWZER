"use client";

import type { DriveFile } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Spinner } from "@brawzer/ui/components/spinner";
import { X } from "lucide-react";
import { useState } from "react";
import { previewUrl } from "@/lib/api/drive";
import { describeType, formatBytes, previewKind } from "@/lib/drive";

/**
 * Shows a clean, previewable file without saving it anywhere. Images load as
 * images; PDFs and text load in a frame, where the server's headers stop
 * them from acting as a page.
 */
export function PreviewDialog({
  file,
  open,
  onOpenChange,
}: {
  file: DriveFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const kind = previewKind(file);
  const [loaded, setLoaded] = useState(false);
  const url = previewUrl(file.id);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLoaded(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(100vw-2rem,56rem)] max-w-none overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle className="min-w-0 truncate">{file.name}</DialogTitle>
          {/* Escape can't reach the dialog while a frame has focus, so there is always a button. */}
          <DialogClose render={<Button variant="ghost" size="sm" aria-label="Close preview" />}>
            <X aria-hidden="true" />
          </DialogClose>
        </div>
        <DialogDescription>
          {describeType(file.contentType)} · {formatBytes(file.size)}. Shown from Drive; nothing is
          saved to this computer.
        </DialogDescription>
        <div
          className="relative mt-4 flex min-h-48 items-center justify-center overflow-hidden rounded-lg border border-line bg-canvas-subtle"
          aria-busy={!loaded}
        >
          {!loaded && <Spinner className="absolute" />}
          {kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- private content streamed per request with the session cookie; it must never pass through an image optimiser or its cache
            <img
              src={url}
              alt={`Preview of ${file.name}`}
              className="max-h-[70dvh] max-w-full object-contain"
              onLoad={() => {
                setLoaded(true);
              }}
              data-testid="drive-preview-image"
            />
          )}
          {(kind === "pdf" || kind === "text") && (
            <iframe
              src={url}
              title={`Preview of ${file.name}`}
              className="h-[70dvh] w-full bg-surface"
              {...(kind === "text" ? { sandbox: "" } : {})}
              onLoad={() => {
                setLoaded(true);
              }}
              data-testid="drive-preview-frame"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
