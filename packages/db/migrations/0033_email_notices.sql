ALTER TYPE "public"."email_token_purpose" ADD VALUE 'unsubscribe';--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;