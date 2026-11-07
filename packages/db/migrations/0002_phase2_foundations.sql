CREATE TYPE "public"."auth_challenge_purpose" AS ENUM('passkey_registration', 'passkey_authentication', 'mfa', 'phone_approval');--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'reauthenticated';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'passkey.added';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'passkey.removed';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'mfa.enabled';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'mfa.disabled';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'mfa.recovery_codes_regenerated';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'mfa.recovery_code_used';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'mfa.failed';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'email.change_requested';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'email.changed';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'data.exported';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'profile.created';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'profile.deleted';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'proxy.created';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'proxy.updated';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'proxy.deleted';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'sign_in.new_device';--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"purpose" "auth_challenge_purpose" NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"challenge" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "auth_method" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "reauthenticated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_idx" ON "auth_challenges" USING btree ("expires_at");