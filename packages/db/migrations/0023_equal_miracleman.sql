CREATE TYPE "public"."team_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.created';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.joined';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.left';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.member_removed';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.role_changed';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.ownership_transferred';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.deleted';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'team.invitation_sent';--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "team_role" NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_team_email_unique" ON "team_invitations" USING btree ("team_id","email");--> statement-breakpoint
CREATE INDEX "team_invitations_email_idx" ON "team_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_user_unique" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_one_owner" ON "team_members" USING btree ("team_id") WHERE role = 'owner';