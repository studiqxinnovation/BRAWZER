import {
  type ChangePasswordRequest,
  currentSessionResponseSchema,
  messageResponseSchema,
  reauthenticateResponseSchema,
  revokeOtherSessionsResponseSchema,
  securityEventPageSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

/** Signs out one of the account's other devices. */
export const endSession = (id: string) =>
  apiRequest<undefined>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });

export const endOtherSessions = () =>
  apiRequest("/auth/sessions/revoke-others", {
    method: "POST",
    schema: revokeOtherSessionsResponseSchema,
  });

export const changePassword = (body: ChangePasswordRequest) =>
  apiRequest("/auth/password/change", { method: "POST", body, schema: messageResponseSchema });

export const securityEvents = (before?: string) =>
  apiRequest(
    `/security/events?${new URLSearchParams({ limit: "20", ...(before ? { before } : {}) }).toString()}`,
    { schema: securityEventPageSchema },
  );

/** Is the session still valid? Doesn't count as activity. */
export const checkSession = () => apiRequest<undefined>("/auth/session/status");

/** Tells the server the person is still here. */
export const reportActivity = () =>
  apiRequest("/auth/session", { schema: currentSessionResponseSchema });

/** Activity plus a fresh session token. */
export const rotateSession = () =>
  apiRequest("/auth/refresh", { method: "POST", schema: currentSessionResponseSchema });

/** Proves who you are again before a sensitive change. */
export const reauthenticate = (password: string) =>
  apiRequest("/auth/reauthenticate", {
    method: "POST",
    body: { password },
    schema: reauthenticateResponseSchema,
  });
