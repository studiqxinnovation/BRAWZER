DROP INDEX "drive_files_sibling_name_unique";--> statement-breakpoint
DROP INDEX "drive_folders_sibling_name_unique";--> statement-breakpoint
ALTER TABLE "drive_files" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_files_owner_sibling_name_unique" ON "drive_files" USING btree (coalesce("team_id", "user_id"),coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "drive_files_team_idx" ON "drive_files" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_folders_owner_sibling_name_unique" ON "drive_folders" USING btree (coalesce("team_id", "user_id"),coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "drive_folders_team_idx" ON "drive_folders" USING btree ("team_id");