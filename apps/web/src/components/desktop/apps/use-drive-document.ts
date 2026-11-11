"use client";

import { useToast } from "@brawzer/ui/components/toast";
import { useCallback, useEffect, useRef, useState } from "react";
import { readDriveText, updateFile } from "@/lib/api/drive";
import { useAppWindow } from "./app-window";
import { saveToDrive } from "./drive-save";

export interface DriveDocument {
  /** The Drive file it was opened from or last saved to; null: never saved. */
  fileId: string | null;
  name: string;
}

/**
 * A document an editor keeps in Drive: opened from the window's `file`
 * param (or a Drive file chosen later), saved over the same file, or as a
 * new one. The window's title follows its name, with • while it has
 * unsaved changes.
 */
export function useDriveDocument({
  defaultName,
  folder,
  type,
  onLoad,
}: {
  defaultName: string;
  /** Where a new document goes, such as "Documents". */
  folder: string;
  type: string;
  onLoad: (text: string, name: string) => void;
}) {
  const toast = useToast();
  const window = useAppWindow();
  const [doc, setDoc] = useState<DriveDocument>(() => ({
    fileId: window.params.file ?? null,
    name: window.params.name ?? defaultName,
  }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(window.params.file));
  const loadRef = useRef(onLoad);
  useEffect(() => {
    loadRef.current = onLoad;
  });

  const open = useCallback(
    async (fileId: string, name: string) => {
      setLoading(true);
      const result = await readDriveText(fileId);
      setLoading(false);
      if (!result.ok) {
        toast.add({
          type: "error",
          title: `Couldn’t open “${name}”`,
          description: result.error.message,
        });
        return;
      }
      loadRef.current(result.data, name);
      setDoc({ fileId, name });
      setDirty(false);
    },
    [toast],
  );

  // Opened with a file from Files or a recent list.
  const first = useRef(window.params.file);
  useEffect(() => {
    const fileId = first.current;
    if (fileId) void open(fileId, window.params.name ?? defaultName);
    // Once, for the file the window was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { setTitle } = window;
  useEffect(() => {
    setTitle(`${dirty ? "• " : ""}${doc.name}`);
  }, [doc.name, dirty, setTitle]);

  const save = useCallback(
    async (content: BlobPart, as?: string) => {
      setSaving(true);
      const name = as ?? doc.name;
      const result = await saveToDrive({
        name,
        content,
        type,
        folder: doc.fileId && !as ? undefined : folder,
        replaces: as ? null : doc.fileId,
      });
      setSaving(false);
      if (!result.ok) {
        toast.add({ type: "error", title: "Couldn’t save it", description: result.error.message });
        return false;
      }
      let saved = result.data;
      // Renamed in the editor: the file in Drive takes the new name too.
      if (saved.name !== name) {
        const renamed = await updateFile(saved.id, { name });
        if (renamed.ok) saved = renamed.data;
      }
      setDoc({ fileId: saved.id, name: saved.name });
      setDirty(false);
      toast.add({ type: "success", title: `Saved “${saved.name}” in Drive` });
      return true;
    },
    [doc, folder, toast, type],
  );

  return {
    doc,
    dirty,
    saving,
    loading,
    changed: () => {
      setDirty(true);
    },
    open,
    save,
    rename: (name: string) => {
      setDoc((current) => ({ ...current, name }));
    },
  };
}
