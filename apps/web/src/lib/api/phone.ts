import {
  phoneApprovalSchema,
  phoneSignInPollResponseSchema,
  phoneSignInStartResponseSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

/** The computer's side (milestone 2.7). */
export const startPhoneSignIn = () =>
  apiRequest("/auth/phone/start", { method: "POST", schema: phoneSignInStartResponseSchema });

export const pollPhoneSignIn = (requestId: string, pollToken: string) =>
  apiRequest(`/auth/phone/${encodeURIComponent(requestId)}/poll`, {
    method: "POST",
    body: { pollToken },
    schema: phoneSignInPollResponseSchema,
  });

/** The phone's side. */
export const describePhoneApproval = (requestId: string, key: string) =>
  apiRequest(
    `/auth/phone/${encodeURIComponent(requestId)}?${new URLSearchParams({ key }).toString()}`,
    { schema: phoneApprovalSchema },
  );

export const approvePhoneSignIn = (requestId: string, key: string, code: string) =>
  apiRequest(`/auth/phone/${encodeURIComponent(requestId)}/approve`, {
    method: "POST",
    body: { key, code },
    schema: phoneApprovalSchema,
  });

export const denyPhoneSignIn = (requestId: string, key: string) =>
  apiRequest(`/auth/phone/${encodeURIComponent(requestId)}/deny`, {
    method: "POST",
    body: { key },
    schema: phoneApprovalSchema,
  });
