import {
  apiErrorSchema,
  type CopyFileRequest,
  type CreateFolderRequest,
  downloadTicketSchema,
  type DriveFile,
  type DriveFileKind,
  driveFileListSchema,
  driveOverviewSchema,
  driveFileSchema,
  driveFolderSchema,
  type DriveSpace,
  type UpdateFileRequest,
  type UpdateFolderRequest,
} from "@brawzer/contracts";
import { type ApiFailure, type ApiResult, apiRequest } from "./client";

/** Every folder and the usage. */
export const fetchDriveOverview = (space: DriveSpace = "personal") =>
  apiRequest(space === "team" ? "/drive?space=team" : "/drive", { schema: driveOverviewSchema });

/** One folder's files (the top level without `folderId`), or a search everywhere with `q`. */
export const listDriveFiles = (
  query: { folderId?: string | null; q?: string; kind?: DriveFileKind; space?: DriveSpace } = {},
) => {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  else if (query.q) params.set("q", query.q);
  else if (query.folderId) params.set("folderId", query.folderId);
  if (query.space === "team") params.set("space", "team");
  const search = params.toString();
  return apiRequest(`/drive/files${search ? `?${search}` : ""}`, { schema: driveFileListSchema });
};

/** The files in a top-level folder found by its name; none if there's no such folder (or Drive can't be read). */
export async function listFilesInFolder(name: string): Promise<DriveFile[]> {
  const overview = await fetchDriveOverview();
  if (!overview.ok) return [];
  const folder = overview.data.folders.find(
    (candidate) => candidate.parentId === null && candidate.name === name,
  );
  if (!folder) return [];
  const files = await listDriveFiles({ folderId: folder.id });
  return files.ok ? files.data.files : [];
}

export const createFolder = (body: CreateFolderRequest) =>
  apiRequest("/drive/folders", { method: "POST", body, schema: driveFolderSchema });

export const updateFolder = (id: string, body: UpdateFolderRequest) =>
  apiRequest(`/drive/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    schema: driveFolderSchema,
  });

export const deleteFolder = (id: string) =>
  apiRequest<undefined>(`/drive/folders/${encodeURIComponent(id)}`, { method: "DELETE" });

export const updateFile = (id: string, body: UpdateFileRequest) =>
  apiRequest(`/drive/files/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    schema: driveFileSchema,
  });

export const deleteFile = (id: string) =>
  apiRequest<undefined>(`/drive/files/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Saves a new version of a file: same name, folder and id. */
export async function replaceDriveFile(id: string, file: File): Promise<ApiResult<DriveFile>> {
  const form = new FormData();
  form.append("file", file, file.name);
  let response: Response;
  try {
    response = await fetch(`/api/v1/drive/files/${encodeURIComponent(id)}/content`, {
      method: "PUT",
      body: form,
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: unreachable };
  }
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    return {
      ok: false,
      status: response.status,
      error: parsed.success ? parsed.data.error : unexpected,
    };
  }
  const parsed = driveFileSchema.safeParse(payload);
  return parsed.success
    ? { ok: true, status: response.status, data: parsed.data }
    : { ok: false, status: response.status, error: unexpected };
}

/** What's in Trash, newest first. */
export const fetchTrash = (space: DriveSpace = "personal") =>
  apiRequest(space === "team" ? "/drive/trash?space=team" : "/drive/trash", {
    schema: driveFileListSchema,
  });

export const restoreFile = (id: string) =>
  apiRequest(`/drive/files/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    schema: driveFileSchema,
  });

export const deleteForever = (id: string) =>
  apiRequest<undefined>(`/drive/trash/${encodeURIComponent(id)}`, { method: "DELETE" });

export const emptyTrash = (space: DriveSpace = "personal") =>
  apiRequest<undefined>(space === "team" ? "/drive/trash?space=team" : "/drive/trash", {
    method: "DELETE",
  });

/** A clean file's text, read through the preview route (same origin, session cookie). */
export async function readDriveText(id: string): Promise<ApiResult<string>> {
  try {
    const response = await fetch(previewUrl(id), { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: { code: "not_found", message: "That file can’t be opened here." },
      };
    }
    return { ok: true, status: response.status, data: await response.text() };
  } catch {
    return { ok: false, status: 0, error: unreachable };
  }
}

/** A clean file's bytes, for an app that reads Office files, through the same route. */
export async function readDriveBytes(id: string): Promise<ApiResult<Uint8Array>> {
  try {
    const response = await fetch(previewUrl(id), { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: { code: "not_found", message: "That file can’t be opened here." },
      };
    }
    return {
      ok: true,
      status: response.status,
      data: new Uint8Array(await response.arrayBuffer()),
    };
  } catch {
    return { ok: false, status: 0, error: unreachable };
  }
}

/** A copy of the file: beside it, in a folder, or at the top level with null. */
export const copyDriveFile = (id: string, body: CopyFileRequest = {}) =>
  apiRequest(`/drive/files/${encodeURIComponent(id)}/copy`, {
    method: "POST",
    body,
    schema: driveFileSchema,
  });

/** A single-use link to save the file to this computer. Needs a recent sign-in. */
export const requestDownloadTicket = (id: string) =>
  apiRequest(`/drive/files/${encodeURIComponent(id)}/download-ticket`, {
    method: "POST",
    schema: downloadTicketSchema,
  });

/** Where the browser can show a clean, previewable file. Same origin, session cookie. */
export const previewUrl = (id: string) => `/api/v1/drive/files/${encodeURIComponent(id)}/preview`;

const unreachable: ApiFailure = {
  code: "service_unavailable",
  message: "Brawzer can’t be reached. Check your internet connection and try again.",
};

const unexpected: ApiFailure = {
  code: "internal_error",
  message: "Something went wrong on our side. Try again in a moment.",
};

export interface UploadHandle {
  result: Promise<ApiResult<DriveFile>>;
  abort(): void;
}

/**
 * Uploads one file as multipart form data, reporting progress as it goes.
 * fetch() can't report upload progress, so this uses XMLHttpRequest; the
 * outcome has the same shape as every other API call.
 */
export function uploadDriveFile(
  file: File,
  folderId: string | null,
  onProgress: (fraction: number) => void,
  space: DriveSpace = "personal",
): UploadHandle {
  const request = new XMLHttpRequest();
  const result = new Promise<ApiResult<DriveFile>>((resolve) => {
    const params = new URLSearchParams();
    if (folderId) params.set("folderId", folderId);
    else if (space === "team") params.set("space", "team");
    const query = params.size > 0 ? `?${params.toString()}` : "";
    request.open("POST", `/api/v1/drive/files${query}`);
    request.setRequestHeader("accept", "application/json");
    request.responseType = "text";
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    });
    request.addEventListener("error", () => {
      resolve({ ok: false, status: 0, error: unreachable });
    });
    request.addEventListener("abort", () => {
      resolve({
        ok: false,
        status: 0,
        error: { code: "bad_request", message: "The upload was cancelled." },
      });
    });
    request.addEventListener("load", () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = undefined;
      }
      if (request.status < 200 || request.status >= 300) {
        const parsed = apiErrorSchema.safeParse(payload);
        const fallback = request.status >= 502 && request.status <= 504 ? unreachable : unexpected;
        resolve({
          ok: false,
          status: request.status,
          error: parsed.success ? parsed.data.error : fallback,
        });
        return;
      }
      const parsed = driveFileSchema.safeParse(payload);
      resolve(
        parsed.success
          ? { ok: true, status: request.status, data: parsed.data }
          : { ok: false, status: request.status, error: unexpected },
      );
    });
    const form = new FormData();
    form.append("file", file, file.name);
    request.send(form);
  });
  return {
    result,
    abort: () => {
      request.abort();
    },
  };
}
