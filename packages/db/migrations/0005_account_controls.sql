ALTER TYPE "public"."email_token_purpose" ADD VALUE 'change_email';--> statement-breakpoint
CREATE TABLE "known_devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_user_device_unique" UNIQUE("user_id","device_key")
);
--> statement-breakpoint
ALTER TABLE "email_tokens" ADD COLUMN "new_email" text;--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;