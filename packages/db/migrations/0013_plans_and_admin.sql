CREATE TYPE "public"."account_role" AS ENUM('user', 'admin');--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'billing.subscription_started' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'billing.subscription_changed' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'billing.subscription_ended' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'admin.plan_changed' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
CREATE TABLE "billing_events" (
	"stripe_event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"status" text NOT NULL,
	"plan_code" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "account_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_code" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_source" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_note" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_unique" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_customer_unique" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_subscription_idx" ON "subscriptions" USING btree ("stripe_subscription_id");