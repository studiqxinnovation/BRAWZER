CREATE TYPE "public"."browser_session_status" AS ENUM('starting', 'running', 'ended');--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'browser.session_started' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'browser.session_ended' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_session_id" uuid NOT NULL,
	"profile_id" uuid,
	"engine" "browser_engine" DEFAULT 'chromium' NOT NULL,
	"status" "browser_session_status" DEFAULT 'starting' NOT NULL,
	"container_id" text,
	"agent_address" text,
	"agent_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_auth_session_id_auth_sessions_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_sessions_user_status_idx" ON "browser_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "browser_sessions_auth_session_idx" ON "browser_sessions" USING btree ("auth_session_id");--> statement-breakpoint
CREATE INDEX "browser_sessions_profile_idx" ON "browser_sessions" USING btree ("profile_id");