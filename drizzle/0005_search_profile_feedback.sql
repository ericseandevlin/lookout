ALTER TABLE "profiles" ADD COLUMN "search_profile" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "search_profile_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "search_profile_hash" text;--> statement-breakpoint
ALTER TABLE "user_opportunities" ADD COLUMN "feedback" jsonb;