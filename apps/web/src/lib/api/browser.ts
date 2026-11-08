import {
  browserOverviewSchema,
  browserSessionSchema,
  type StartBrowserSessionRequest,
  streamTicketSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const fetchBrowserOverview = () => apiRequest("/browser", { schema: browserOverviewSchema });

export const startBrowserSession = (body: StartBrowserSessionRequest) =>
  apiRequest("/browser/sessions", { method: "POST", body, schema: browserSessionSchema });

export const endBrowserSession = (id: string) =>
  apiRequest<undefined>(`/browser/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });

/** A single-use ticket and the WebSocket URL to present it on. */
export const requestStreamTicket = (id: string) =>
  apiRequest(`/browser/sessions/${encodeURIComponent(id)}/ticket`, {
    method: "POST",
    schema: streamTicketSchema,
  });
