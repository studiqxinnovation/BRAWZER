"use client";

import type { DriveFile } from "@brawzer/contracts";
import { createFolder, deleteFile, fetchDriveOverview, uploadDriveFile } from "@/lib/api/drive";
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
 * any upload. Saving over a file uploads the new version, then removes the
 * old one, so a failed upload leaves the old one as it was.
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
  let folderId: string | null = null;
  if (folder) {
    const found = await driveFolder(folder);
    if (!found.ok) return found;
    folderId = found.data;
  }
  const file = new File([content], name, { type });
  const uploaded = await uploadDriveFile(file, folderId, () => undefined).result;
  if (uploaded.ok && replaces && replaces !== uploaded.data.id) {
    await deleteFile(replaces);
  }
  return uploaded;
}
