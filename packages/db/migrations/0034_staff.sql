ALTER TYPE "public"."account_role" ADD VALUE IF NOT EXISTS 'care';--> statement-breakpoint
ALTER TYPE "public"."account_role" ADD VALUE IF NOT EXISTS 'billing';--> statement-breakpoint
ALTER TYPE "public"."account_role" ADD VALUE IF NOT EXISTS 'sales';--> statement-breakpoint
ALTER TYPE "public"."account_role" ADD VALUE IF NOT EXISTS 'technical';--> statement-breakpoint
ALTER TYPE "public"."account_role" ADD VALUE IF NOT EXISTS 'security';--> statement-breakpoint
CREATE TABLE "staff_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "staff_actions" ADD CONSTRAINT "staff_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_actions_created_idx" ON "staff_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "staff_actions_target_idx" ON "staff_actions" USING btree ("target");--> statement-breakpoint
CREATE INDEX "staff_notes_user_idx" ON "staff_notes" USING btree ("user_id");