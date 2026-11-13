import { messageResponseSchema, recoveryConfirmedSchema } from "@brawzer/contracts";
import { apiRequest } from "./client";

/** Account recovery, from the sign-in side. */
export const startRecovery = (email: string) =>
  apiRequest("/auth/recovery/start", {
    method: "POST",
    body: { email },
    schema: messageResponseSchema,
  });
export const confirmRecovery = (token: string) =>
  apiRequest("/auth/recovery/confirm", {
    method: "POST",
    body: { token },
    schema: recoveryConfirmedSchema,
  });
export const cancelRecovery = (token: string) =>
  apiRequest("/auth/recovery/cancel", {
    method: "POST",
    body: { token },
    schema: messageResponseSchema,
  });
