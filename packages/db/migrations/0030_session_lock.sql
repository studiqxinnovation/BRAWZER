ALTER TYPE "public"."security_event_type" ADD VALUE 'session.locked';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'session.unlocked';--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "locked_at" timestamp with time zone;