CREATE TYPE "public"."browser_engine" AS ENUM('chromium', 'firefox');--> statement-breakpoint
CREATE TYPE "public"."profile_color" AS ENUM('indigo', 'teal', 'copper', 'violet', 'navy', 'rose', 'green', 'slate');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" "profile_color" NOT NULL,
	"engine" "browser_engine" DEFAULT 'chromium' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_name_unique" ON "profiles" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "profiles_user_position_idx" ON "profiles" USING btree ("user_id","position");--> statement-breakpoint
-- Every confirmed account starts with a "Personal" profile; this gives one to
-- accounts confirmed before profiles existed.
INSERT INTO "profiles" ("user_id", "name", "color", "engine", "position")
SELECT "id", 'Personal', 'indigo', 'chromium', 0 FROM "users"
WHERE "email_verified_at" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "profiles" WHERE "profiles"."user_id" = "users"."id");
