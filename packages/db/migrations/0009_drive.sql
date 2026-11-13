CREATE TYPE "public"."drive_file_source" AS ENUM('upload');--> statement-breakpoint
CREATE TYPE "public"."drive_file_status" AS ENUM('clean', 'infected');--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'drive.file_uploaded' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'drive.file_quarantined' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'drive.file_deleted' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'drive.file_saved' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'drive.folder_deleted' BEFORE 'phone_sign_in.approved';--> statement-breakpoint
CREATE TABLE "drive_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"status" "drive_file_status" NOT NULL,
	"threat" text,
	"source" "drive_file_source" DEFAULT 'upload' NOT NULL,
	"wrapped_key" text NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_files_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "drive_files_size_nonnegative" CHECK ("drive_files"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drive_folders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_folder_id_drive_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."drive_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_parent_id_drive_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_files_sibling_name_unique" ON "drive_files" USING btree ("user_id",coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "drive_files_user_idx" ON "drive_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drive_files_folder_idx" ON "drive_files" USING btree ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_folders_sibling_name_unique" ON "drive_folders" USING btree ("user_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "drive_folders_user_idx" ON "drive_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drive_folders_parent_idx" ON "drive_folders" USING btree ("parent_id");