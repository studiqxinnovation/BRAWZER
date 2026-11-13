import { z } from "zod";
import { emailSchema } from "./auth.ts";

/**
 * Team accounts (Phase 8, idea 19; ADR 0019). A person belongs to at most
 * one team. Its owner's plan applies to every member, and the team shares
 * a proxy list and a Drive space. Must match the database enum `team_role`.
 */
export const teamRoles = ["owner", "admin", "member"] as const;
export const teamRoleSchema = z.enum(teamRoles);
export type TeamRole = z.infer<typeof teamRoleSchema>;

/** Roles an invitation or a role change can give; ownership is handed over instead. */
export const assignableTeamRoles = ["admin", "member"] as const;
export const assignableTeamRoleSchema = z.enum(assignableTeamRoles, {
  error: "Choose admin or member.",
});

export const TEAM_LIMITS = {
  /** Members, owner included, on the built-in free plan and any plan that doesn't say. */
  defaultMembers: 3,
  /** An invitation waits this long. */
  invitationDays: 7,
} as const;

export const teamNameSchema = z
  .string({ error: "Name the team." })
  .trim()
  .min(1, "Name the team.")
  .max(60, "Keep the name under 60 characters.")
  // eslint-disable-next-line no-control-regex -- a name goes into email subjects: no line breaks
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    error: "Use letters, digits, spaces and punctuation only.",
  });

export const teamMemberSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  role: teamRoleSchema,
  joinedAt: z.iso.datetime(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamInvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: assignableTeamRoleSchema,
  invitedBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type TeamInvitation = z.infer<typeof teamInvitationSchema>;

export const teamSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The signed-in person's role. */
  role: teamRoleSchema,
  createdAt: z.iso.datetime(),
  members: z.array(teamMemberSchema),
  /** Waiting invitations; listed to the owner and admins only. */
  invitations: z.array(teamInvitationSchema),
  /** People the owner's plan allows, owner included. */
  seats: z.number().int().positive(),
  /** The owner's plan, which every member uses. */
  planName: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

/** An invitation addressed to the signed-in person's email address. */
export const invitationForMeSchema = z.object({
  id: z.uuid(),
  teamName: z.string(),
  invitedBy: z.string().nullable(),
  role: assignableTeamRoleSchema,
  expiresAt: z.iso.datetime(),
});
export type InvitationForMe = z.infer<typeof invitationForMeSchema>;

export const teamOverviewSchema = z.object({
  team: teamSchema.nullable(),
  invitations: z.array(invitationForMeSchema),
  /** People a team started now could have, from the person's own plan. */
  seats: z.number().int().positive(),
});
export type TeamOverview = z.infer<typeof teamOverviewSchema>;

export const createTeamRequestSchema = z.object({ name: teamNameSchema });
export const renameTeamRequestSchema = z.object({ name: teamNameSchema });
export const inviteTeamMemberRequestSchema = z.object({
  email: emailSchema,
  role: assignableTeamRoleSchema,
});
export type InviteTeamMemberRequest = z.input<typeof inviteTeamMemberRequestSchema>;
export const updateTeamMemberRequestSchema = z.object({ role: assignableTeamRoleSchema });
export const transferTeamRequestSchema = z.object({ userId: z.uuid() });
