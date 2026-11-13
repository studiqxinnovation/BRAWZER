CREATE TYPE "public"."extension_status" AS ENUM('allowed', 'review', 'blocked');--> statement-breakpoint
CREATE TABLE "extension_policies" (
	"slug" text PRIMARY KEY NOT NULL,
	"status" "extension_status" DEFAULT 'allowed' NOT NULL,
	"reason" text,
	"changed_by_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extension_policies" ADD CONSTRAINT "extension_policies_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;