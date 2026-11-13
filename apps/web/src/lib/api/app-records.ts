import { type AppRecordApp, appRecordListSchema, appRecordSchema } from "@brawzer/contracts";
import { apiRequest } from "./client";

export const fetchAppRecords = (app: AppRecordApp) =>
  apiRequest(`/apps/${app}/records`, { schema: appRecordListSchema });

export const putAppRecord = (
  app: AppRecordApp,
  key: string,
  data: unknown,
  options: { keepalive?: boolean } = {},
) =>
  apiRequest(`/apps/${app}/records/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: { data },
    schema: appRecordSchema,
    ...options,
  });

export const deleteAppRecord = (app: AppRecordApp, key: string) =>
  apiRequest<undefined>(`/apps/${app}/records/${encodeURIComponent(key)}`, { method: "DELETE" });
