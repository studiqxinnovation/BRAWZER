import {
  bookmarkListSchema,
  bookmarkSchema,
  type CreateBookmarkRequest,
  historyPageSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

const base = (profileId: string): `/profiles/${string}` =>
  `/profiles/${encodeURIComponent(profileId)}`;

export const fetchHistory = (profileId: string, query: { q?: string; cursor?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.cursor) params.set("cursor", query.cursor);
  const search = params.size > 0 ? `?${params.toString()}` : "";
  return apiRequest(`${base(profileId)}/history${search}`, { schema: historyPageSchema });
};

export const forgetHistoryEntry = (profileId: string, entryId: string) =>
  apiRequest<undefined>(`${base(profileId)}/history/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });

export const clearHistory = (profileId: string) =>
  apiRequest<undefined>(`${base(profileId)}/history`, { method: "DELETE" });

export const fetchBookmarks = (profileId: string) =>
  apiRequest(`${base(profileId)}/bookmarks`, { schema: bookmarkListSchema });

export const addBookmark = (profileId: string, body: CreateBookmarkRequest) =>
  apiRequest(`${base(profileId)}/bookmarks`, { method: "POST", body, schema: bookmarkSchema });

export const renameBookmark = (profileId: string, id: string, title: string) =>
  apiRequest(`${base(profileId)}/bookmarks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { title },
    schema: bookmarkSchema,
  });

export const removeBookmark = (profileId: string, id: string) =>
  apiRequest<undefined>(`${base(profileId)}/bookmarks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
