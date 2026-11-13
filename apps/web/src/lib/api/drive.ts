import {
  apiErrorSchema,
  type CreateFolderRequest,
  downloadTicketSchema,
  type DriveFile,
  driveFileSchema,
  driveFolderSchema,
  type UpdateFileRequest,
  type UpdateFolderRequest,
} from "@brawzer/contracts";
import { type ApiFailure, type ApiResult, apiRequest } from "./client";

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
): UploadHandle {
  const request = new XMLHttpRequest();
  const result = new Promise<ApiResult<DriveFile>>((resolve) => {
    const query = folderId ? `?${new URLSearchParams({ folderId }).toString()}` : "";
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
