import {
  type CurrentSessionResponse,
  currentSessionResponseSchema,
  type LoginRequest,
  type LoginResponse,
  loginResponseSchema,
  type MessageResponse,
  messageResponseSchema,
  type RegisterRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const register = (body: RegisterRequest) =>
  apiRequest<MessageResponse>("/auth/register", {
    method: "POST",
    body,
    schema: messageResponseSchema,
  });

export const verifyEmail = (body: VerifyEmailRequest) =>
  apiRequest<CurrentSessionResponse>("/auth/verify-email", {
    method: "POST",
    body,
    schema: currentSessionResponseSchema,
  });

/** A session, or a two-factor challenge for accounts with two-factor authentication. */
export const login = (body: LoginRequest) =>
  apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body,
    schema: loginResponseSchema,
  });

export const logout = () => apiRequest<undefined>("/auth/logout", { method: "POST" });

export const requestPasswordReset = (email: string) =>
  apiRequest<MessageResponse>("/auth/password/forgot", {
    method: "POST",
    body: { email },
    schema: messageResponseSchema,
  });

export const resetPassword = (body: ResetPasswordRequest) =>
  apiRequest<MessageResponse>("/auth/password/reset", {
    method: "POST",
    body,
    schema: messageResponseSchema,
  });
