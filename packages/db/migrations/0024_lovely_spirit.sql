DROP INDEX "proxies_user_name_unique";--> statement-breakpoint
ALTER TABLE "proxies" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proxies_owner_name_unique" ON "proxies" USING btree (coalesce("team_id", "user_id"),lower("name"));--> statement-breakpoint
CREATE INDEX "proxies_team_idx" ON "proxies" USING btree ("team_id");