import { type InviteTeamMemberRequest, teamOverviewSchema } from "@brawzer/contracts";
import { apiRequest } from "./client";

const schema = teamOverviewSchema;

export const createTeam = (name: string) =>
  apiRequest("/team", { method: "POST", body: { name }, schema });

export const renameTeam = (name: string) =>
  apiRequest("/team", { method: "PATCH", body: { name }, schema });

export const deleteTeam = () => apiRequest("/team", { method: "DELETE", schema });

export const inviteToTeam = (body: InviteTeamMemberRequest) =>
  apiRequest("/team/invitations", { method: "POST", body, schema });

export const withdrawInvitation = (id: string) =>
  apiRequest(`/team/invitations/${encodeURIComponent(id)}`, { method: "DELETE", schema });

export const joinTeam = (id: string) =>
  apiRequest(`/team/invitations/${encodeURIComponent(id)}/join`, {
    method: "POST",
    body: {},
    schema,
  });

export const declineInvitation = (id: string) =>
  apiRequest(`/team/invitations/${encodeURIComponent(id)}/decline`, {
    method: "POST",
    body: {},
    schema,
  });

export const setTeamRole = (userId: string, role: "admin" | "member") =>
  apiRequest(`/team/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: { role },
    schema,
  });

export const removeFromTeam = (userId: string) =>
  apiRequest(`/team/members/${encodeURIComponent(userId)}`, { method: "DELETE", schema });

export const leaveTeam = () => apiRequest("/team/leave", { method: "POST", body: {}, schema });

export const transferTeam = (userId: string) =>
  apiRequest("/team/transfer", { method: "POST", body: { userId }, schema });
