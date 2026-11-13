CREATE TYPE "public"."recovery_status" AS ENUM('verifying', 'waiting', 'released', 'denied');--> statement-breakpoint
ALTER TYPE "public"."email_token_purpose" ADD VALUE 'recovery_confirm';--> statement-breakpoint
ALTER TYPE "public"."email_token_purpose" ADD VALUE 'recovery_cancel';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'recovery.requested';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'recovery.cancelled';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'recovery.released';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'recovery.denied';--> statement-breakpoint
CREATE TABLE "recovery_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "recovery_status" DEFAULT 'verifying' NOT NULL,
	"opened_by_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_ip" text,
	"request_user_agent" text,
	"email_confirmed_at" timestamp with time zone,
	"device_known" boolean,
	"release_at" timestamp with time zone,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by_owner" boolean DEFAULT false NOT NULL,
	"closed_reason" text,
	"released_early" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_cases_status_idx" ON "recovery_cases" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "recovery_cases_user_idx" ON "recovery_cases" USING btree ("user_id");