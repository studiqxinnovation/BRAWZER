import {
  currentSessionResponseSchema,
  passkeyOptionsResponseSchema,
  passkeySchema,
  reauthenticateResponseSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const signInOptions = () =>
  apiRequest("/auth/passkeys/authentication/options", {
    method: "POST",
    schema: passkeyOptionsResponseSchema,
  });

export const verifySignIn = (body: {
  challengeId: string;
  keepSignedIn: boolean;
  response: unknown;
}) =>
  apiRequest("/auth/passkeys/authentication/verify", {
    method: "POST",
    body,
    schema: currentSessionResponseSchema,
  });

export const registrationOptions = () =>
  apiRequest("/auth/passkeys/registration/options", {
    method: "POST",
    schema: passkeyOptionsResponseSchema,
  });

export const verifyRegistration = (body: { challengeId: string; response: unknown }) =>
  apiRequest("/auth/passkeys/registration/verify", { method: "POST", body, schema: passkeySchema });

export const confirmationOptions = () =>
  apiRequest("/auth/passkeys/confirmation/options", {
    method: "POST",
    schema: passkeyOptionsResponseSchema,
  });

export const verifyConfirmation = (body: { challengeId: string; response: unknown }) =>
  apiRequest("/auth/passkeys/confirmation/verify", {
    method: "POST",
    body,
    schema: reauthenticateResponseSchema,
  });

export const renamePasskey = (id: string, name: string) =>
  apiRequest(`/auth/passkeys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { name },
    schema: passkeySchema,
  });

export const removePasskey = (id: string) =>
  apiRequest<undefined>(`/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
