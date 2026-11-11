"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppWindow } from "./app-window";
import { saveToDrive } from "./drive-save";
import { EmptyState } from "./empty-state";
import { preview, useDriveKind } from "./media";

/** Photos: every picture in Drive, and one at a time, larger. */
export default function PhotosApp() {
  const window = useAppWindow();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const photos = useDriveKind("images", version);
  const picker = useRef<HTMLInputElement>(null);

  /** Import photos: into Drive's Photos folder, scanned and encrypted like any upload. */
  async function importPhotos(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const result = await saveToDrive({
        name: file.name,
        content: file,
        type: file.type,
        folder: "Photos",
      });
      if (!result.ok) {
        toast.add({
          type: "error",
          title: `Couldn’t import “${file.name}”`,
          description: result.error.message,
        });
      }
    }
    setVersion((value) => value + 1);
  }
  const importButton = (
    <>
      <Button size="sm" variant="primary" onClick={() => picker.current?.click()}>
        Import photos
      </Button>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          void importPhotos(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
  const [shown, setShown] = useState<string | null>(window.params.file ?? null);
  const index = photos?.findIndex((photo) => photo.id === shown) ?? -1;
  const current = index >= 0 ? photos?.[index] : undefined;
  const { setTitle } = window;
  useEffect(() => {
    setTitle(current ? current.name : null);
  }, [current, setTitle]);

  const step = (by: number) => {
    if (!photos || photos.length === 0 || index < 0) return;
    setShown(photos[(index + by + photos.length) % photos.length]?.id ?? null);
  };

  if (current) {
    return (
      // Arrow keys step through the photos, as a viewer does.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        className="ap-viewer"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "Escape") setShown(null);
        }}
      >
        <div className="ap-viewer-bar">
          <button
            type="button"
            className="ap-tool"
            aria-label="All photos"
            onClick={() => {
              setShown(null);
            }}
          >
            <LayoutGrid aria-hidden="true" />
          </button>
          <span className="flex-1 truncate">{current.name}</span>
          <span>
            {index + 1} of {photos?.length ?? 0}
          </span>
        </div>
        <div className="ap-viewer-stage">
          <button
            type="button"
            className="ap-viewer-nav"
            aria-label="Previous photo"
            onClick={() => {
              step(-1);
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          {/* A Drive preview: same origin, served so it can't run. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview(current)} alt={current.name} />
          <button
            type="button"
            className="ap-viewer-nav"
            aria-label="Next photo"
            onClick={() => {
              step(1);
            }}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <h2 className="ap-place">Library</h2>
        <span className="flex-1" />
        {importButton}
      </div>
      <div className="ap-main">
        {photos === null ? null : photos.length === 0 ? (
          <EmptyState
            glyph="image"
            colour="pink"
            title="No photos yet"
            action={
              <Button size="sm" variant="primary" onClick={() => picker.current?.click()}>
                Import photos
              </Button>
            }
          >
            Import photos from your computer or take a screenshot. They’re kept in your Drive.
          </EmptyState>
        ) : (
          <ul className="ap-photo-grid" aria-label="Photos">
            {photos.map((photo) => (
              <li key={photo.id}>
                <button
                  type="button"
                  className="ap-photo"
                  aria-label={photo.name}
                  onClick={() => {
                    setShown(photo.id);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview(photo)} alt="" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
