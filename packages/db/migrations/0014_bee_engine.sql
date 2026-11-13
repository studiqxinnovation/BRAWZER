-- Chromium becomes Bee, Brawzer's own browser built on Chromium: existing rows keep their meaning.
ALTER TYPE "public"."browser_engine" RENAME VALUE 'chromium' TO 'bee';--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "engine" SET DEFAULT 'bee'::"public"."browser_engine";--> statement-breakpoint
ALTER TABLE "browser_sessions" ALTER COLUMN "engine" SET DEFAULT 'bee'::"public"."browser_engine";
