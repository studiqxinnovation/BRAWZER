import {
  currentSessionResponseSchema,
  mfaStatusSchema,
  recoveryCodesResponseSchema,
  totpSetupResponseSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const verifySecondStep = (ticket: string, code: string) =>
  apiRequest("/auth/mfa/verify", {
    method: "POST",
    body: { ticket, code },
    schema: currentSessionResponseSchema,
  });

export const mfaStatus = () => apiRequest("/auth/mfa", { schema: mfaStatusSchema });

export const startTotpSetup = () =>
  apiRequest("/auth/mfa/totp/setup", { method: "POST", schema: totpSetupResponseSchema });

export const confirmTotpSetup = (code: string) =>
  apiRequest("/auth/mfa/totp/confirm", {
    method: "POST",
    body: { code },
    schema: recoveryCodesResponseSchema,
  });

export const turnOffTotp = () => apiRequest<undefined>("/auth/mfa/totp", { method: "DELETE" });

export const regenerateRecoveryCodes = () =>
  apiRequest("/auth/mfa/recovery-codes", { method: "POST", schema: recoveryCodesResponseSchema });
