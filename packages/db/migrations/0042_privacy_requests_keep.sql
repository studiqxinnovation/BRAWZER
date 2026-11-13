ALTER TABLE "privacy_requests" DROP CONSTRAINT "privacy_requests_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "privacy_requests" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;