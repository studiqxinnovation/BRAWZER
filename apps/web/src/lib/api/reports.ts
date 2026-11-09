import {
  adminPageReportListSchema,
  adminPageReportPictureSchema,
  type CreatePageReportRequest,
  pageReportCreatedSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const sendPageReport = (body: CreatePageReportRequest) =>
  apiRequest("/reports", { method: "POST", body, schema: pageReportCreatedSchema });

export const fetchAdminReports = (state: "open" | "closed") =>
  apiRequest(`/admin/reports?${new URLSearchParams({ state }).toString()}`, {
    schema: adminPageReportListSchema,
  });

export const fetchReportPicture = (id: string) =>
  apiRequest(`/admin/reports/${encodeURIComponent(id)}/picture`, {
    schema: adminPageReportPictureSchema,
  });

export const closeReport = (id: string) =>
  apiRequest<undefined>(`/admin/reports/${encodeURIComponent(id)}/close`, {
    method: "POST",
    body: {},
  });
