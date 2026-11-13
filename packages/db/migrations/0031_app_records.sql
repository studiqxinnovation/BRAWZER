CREATE TABLE "app_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"key" text NOT NULL,
	"sealed" text NOT NULL,
	"bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_records" ADD CONSTRAINT "app_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_records_user_app_key_unique" ON "app_records" USING btree ("user_id","app","key");--> statement-breakpoint
CREATE INDEX "app_records_user_idx" ON "app_records" USING btree ("user_id");