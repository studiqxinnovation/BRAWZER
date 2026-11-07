import {
  accountExportSchema,
  type ChangePasswordRequest,
  confirmEmailChangeResponseSchema,
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
export const reauthenticate = (password: string, code?: string) =>
  apiRequest("/auth/reauthenticate", {
    method: "POST",
    body: { password, ...(code ? { code } : {}) },
    schema: reauthenticateResponseSchema,
  });

/** Sends a confirmation link to the new address. Needs a recent sign-in. */
export const requestEmailChange = (email: string) =>
  apiRequest("/account/email", { method: "POST", body: { email }, schema: messageResponseSchema });

/** Confirms a new address with the token from the emailed link. Works signed out. */
export const confirmEmailChange = (token: string) =>
  apiRequest("/account/email/confirm", {
    method: "POST",
    body: { token },
    schema: confirmEmailChangeResponseSchema,
  });

/** Deletes the account immediately. Needs a recent sign-in. */
export const deleteAccount = (email: string) =>
  apiRequest<undefined>("/account/delete", { method: "POST", body: { email } });

/** Everything Brawzer holds about the account, except secrets. Needs a recent sign-in. */
export const exportAccount = () => apiRequest("/account/export", { schema: accountExportSchema });
