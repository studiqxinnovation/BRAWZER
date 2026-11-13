"use client";

import type { DriveFile, DriveFileKind } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { listDriveFiles } from "@/lib/api/drive";

/** Every clean file of a kind in Drive, for the viewers; a new `version` reads them again. */
export function useDriveKind(kind: DriveFileKind, version = 0) {
  const [files, setFiles] = useState<readonly DriveFile[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listDriveFiles({ kind }).then((result) => {
      if (!cancelled) setFiles(result.ok ? result.data.files : []);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, version]);
  return files;
}

export const preview = (file: { id: string }) =>
  `/api/v1/drive/files/${encodeURIComponent(file.id)}/preview`;
