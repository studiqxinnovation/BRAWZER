ALTER TYPE "public"."security_event_type" ADD VALUE 'profile.history_cleared';--> statement-breakpoint
CREATE TABLE "profile_bookmarks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"url_digest" text NOT NULL,
	"entry" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"url_digest" text NOT NULL,
	"entry" text NOT NULL,
	"first_visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"visits" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "keep_history" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "history_key" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "open_tabs" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "open_tabs_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "open_tabs_handed_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD COLUMN "restore_tabs" text;--> statement-breakpoint
ALTER TABLE "profile_bookmarks" ADD CONSTRAINT "profile_bookmarks_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_history" ADD CONSTRAINT "profile_history_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_bookmarks_profile_digest_unique" ON "profile_bookmarks" USING btree ("profile_id","url_digest");--> statement-breakpoint
CREATE INDEX "profile_bookmarks_profile_created_idx" ON "profile_bookmarks" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_history_profile_digest_unique" ON "profile_history" USING btree ("profile_id","url_digest");--> statement-breakpoint
CREATE INDEX "profile_history_profile_visited_idx" ON "profile_history" USING btree ("profile_id","last_visited_at");