"use client";

import type { DriveFile } from "@brawzer/contracts";
import {
  createFolder,
  fetchDriveOverview,
  replaceDriveFile,
  uploadDriveFile,
} from "@/lib/api/drive";
import type { ApiResult } from "@/lib/api/client";

/** The top-level folder with this name, made if it doesn't exist yet. */
export async function driveFolder(name: string): Promise<ApiResult<string>> {
  const overview = await fetchDriveOverview();
  if (!overview.ok) return overview;
  const existing = overview.data.folders.find(
    (folder) => folder.parentId === null && folder.name === name,
  );
  if (existing) return { ok: true, status: 200, data: existing.id };
  const made = await createFolder({ name, parentId: null, space: "personal" });
  return made.ok ? { ok: true, status: made.status, data: made.data.id } : made;
}

/**
 * Saves what an app made into Drive, where it's scanned and encrypted like
 * any upload. Saving over a file saves a new version of it in place (same
 * name and folder); if it's gone meanwhile, a new file is made.
 */
export async function saveToDrive({
  name,
  content,
  type,
  folder,
  replaces,
}: {
  name: string;
  content: BlobPart;
  type: string;
  /** A top-level folder to keep it in, such as "Invoices"; none: the top level. */
  folder?: string;
  /** The Drive file this one replaces. */
  replaces?: string | null;
}): Promise<ApiResult<DriveFile>> {
  const file = new File([content], name, { type });
  if (replaces) {
    const replaced = await replaceDriveFile(replaces, file);
    if (replaced.ok || replaced.status !== 404) return replaced;
  }
  let folderId: string | null = null;
  if (folder) {
    const found = await driveFolder(folder);
    if (!found.ok) return found;
    folderId = found.data;
  }
  return uploadDriveFile(file, folderId, () => undefined).result;
}
