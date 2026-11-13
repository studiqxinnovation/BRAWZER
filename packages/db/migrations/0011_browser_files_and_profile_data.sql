ALTER TYPE "public"."security_event_type" ADD VALUE 'browser.file_saved' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'browser.file_sent' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'profile.data_cleared' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."drive_file_source" ADD VALUE 'browser';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "keep_data" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "data_object_key" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "data_wrapped_key" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "data_bytes" bigint;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "data_saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_data_object_key_unique" UNIQUE("data_object_key");