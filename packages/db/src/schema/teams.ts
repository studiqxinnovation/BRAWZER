import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/** Must match `teamRoles` in @brawzer/contracts (a test in the API enforces this). */
export const teamRole = pgEnum("team_role", ["owner", "admin", "member"]);

/**
 * A team (Phase 8, idea 19; ADR 0019): people who share a plan, a proxy list
 * and a Drive space. Its owner is the member with the role "owner".
 */
export const teams = pgTable("teams", {
  id: id(),
  name: text().notNull(),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().notNull().defaultNow(),
});

/** One row per member. A person is in at most one team; a team has exactly one owner. */
export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRole().notNull(),
    joinedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    uniqueIndex("team_members_user_unique").on(table.userId),
    uniqueIndex("team_members_one_owner")
      .on(table.teamId)
      .where(sql`role = 'owner'`),
  ],
);

/** An invitation to an email address, seen by the verified account with that address. */
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: id(),
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Lower-case, as accounts store it. */
    email: text().notNull(),
    role: teamRole().notNull(),
    invitedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
  },
  (table) => [
    uniqueIndex("team_invitations_team_email_unique").on(table.teamId, table.email),
    index("team_invitations_email_idx").on(table.email),
  ],
);

export type TeamRow = typeof teams.$inferSelect;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type TeamInvitationRow = typeof teamInvitations.$inferSelect;
