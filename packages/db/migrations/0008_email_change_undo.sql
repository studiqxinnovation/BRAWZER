ALTER TYPE "public"."email_token_purpose" ADD VALUE 'undo_email_change';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'email.change_undone' BEFORE 'data.exported';--> statement-breakpoint
ALTER TABLE "email_tokens" ADD COLUMN "previous_email" text;