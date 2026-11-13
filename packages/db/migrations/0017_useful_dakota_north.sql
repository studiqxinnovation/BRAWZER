CREATE TYPE "public"."site_rule_kind" AS ENUM('allow', 'block');--> statement-breakpoint
CREATE TABLE "site_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "site_rule_kind" NOT NULL,
	"host" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_rules" ADD CONSTRAINT "site_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_rules_user_kind_host_unique" ON "site_rules" USING btree ("user_id","kind","host");--> statement-breakpoint
CREATE INDEX "site_rules_user_idx" ON "site_rules" USING btree ("user_id");