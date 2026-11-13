CREATE TYPE "public"."abuse_kind" AS ENUM('phishing', 'spam', 'fraud', 'bots', 'other');--> statement-breakpoint
CREATE TYPE "public"."abuse_status" AS ENUM('open', 'warned', 'suspended', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."legal_request_status" AS ENUM('verifying', 'answered', 'refused');--> statement-breakpoint
CREATE TABLE "abuse_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "abuse_kind" NOT NULL,
	"source" text NOT NULL,
	"detail" text NOT NULL,
	"status" "abuse_status" DEFAULT 'open' NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blocked_addresses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"cidr" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"why" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"from_whom" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"status" "legal_request_status" DEFAULT 'verifying' NOT NULL,
	"due_at" timestamp with time zone,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_addresses" ADD CONSTRAINT "blocked_addresses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_requests" ADD CONSTRAINT "legal_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_requests" ADD CONSTRAINT "legal_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abuse_reports_status_idx" ON "abuse_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "blocked_addresses_cidr_idx" ON "blocked_addresses" USING btree ("cidr");--> statement-breakpoint
CREATE INDEX "legal_requests_status_idx" ON "legal_requests" USING btree ("status","created_at");