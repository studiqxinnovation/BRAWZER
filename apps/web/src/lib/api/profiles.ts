import {
  type CreateProfileRequest,
  profileListSchema,
  profileSchema,
  type UpdateProfileRequest,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const fetchProfiles = () => apiRequest("/profiles", { schema: profileListSchema });

export const createProfile = (body: CreateProfileRequest) =>
  apiRequest("/profiles", { method: "POST", body, schema: profileSchema });

export const updateProfile = (id: string, body: UpdateProfileRequest) =>
  apiRequest(`/profiles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    schema: profileSchema,
  });

/** Forgets the profile's cookies, history and site data. */
export const clearProfileData = (id: string) =>
  apiRequest(`/profiles/${encodeURIComponent(id)}/data`, {
    method: "DELETE",
    schema: profileSchema,
  });

export const deleteProfile = (id: string) =>
  apiRequest<undefined>(`/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });

/** `ids`: every profile, in the new order. */
export const reorderProfiles = (ids: readonly string[]) =>
  apiRequest("/profiles/order", { method: "PUT", body: { ids }, schema: profileListSchema });
