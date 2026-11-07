CREATE TYPE "public"."proxy_kind" AS ENUM('unspecified', 'residential', 'datacenter', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."proxy_protocol" AS ENUM('http', 'https', 'socks4', 'socks4a', 'socks5');--> statement-breakpoint
CREATE TYPE "public"."proxy_rotation" AS ENUM('unknown', 'static', 'rotating');--> statement-breakpoint
CREATE TABLE "proxies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"protocol" "proxy_protocol" NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"credentials" text,
	"kind" "proxy_kind" DEFAULT 'unspecified' NOT NULL,
	"rotation" "proxy_rotation" DEFAULT 'unknown' NOT NULL,
	"last_test" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proxies_port_range" CHECK ("proxies"."port" between 1 and 65535)
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "proxy_id" uuid;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proxies_user_name_unique" ON "proxies" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "proxies_user_idx" ON "proxies" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_proxy_id_proxies_id_fk" FOREIGN KEY ("proxy_id") REFERENCES "public"."proxies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_proxy_idx" ON "profiles" USING btree ("proxy_id");