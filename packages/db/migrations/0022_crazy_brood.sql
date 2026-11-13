CREATE TYPE "public"."page_report_kind" AS ENUM('broken', 'blocked', 'other');--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'browser.page_reported' BEFORE 'profile.data_cleared';--> statement-breakpoint
CREATE TABLE "page_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"engine" "browser_engine",
	"kind" "page_report_kind" NOT NULL,
	"message" text NOT NULL,
	"url" text,
	"title" text,
	"error_code" text,
	"picture" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "page_reports" ADD CONSTRAINT "page_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_reports" ADD CONSTRAINT "page_reports_session_id_browser_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_reports" ADD CONSTRAINT "page_reports_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_reports_state_idx" ON "page_reports" USING btree ("closed_at","created_at");--> statement-breakpoint
CREATE INDEX "page_reports_user_idx" ON "page_reports" USING btree ("user_id");