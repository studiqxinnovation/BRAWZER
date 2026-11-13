import { announcementListSchema } from "@brawzer/contracts";
import { apiRequest } from "./client";

/** Banners meant for this account. */
export const fetchAnnouncements = () =>
  apiRequest("/announcements", { schema: announcementListSchema });
export const dismissAnnouncement = (id: string) =>
  apiRequest<undefined>(`/announcements/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
export const clickAnnouncement = (id: string) =>
  apiRequest<undefined>(`/announcements/${encodeURIComponent(id)}/click`, {
    method: "POST",
    keepalive: true,
  });
