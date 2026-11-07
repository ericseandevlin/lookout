-- Clickwrap consent (#21): which Terms and Privacy versions each person agreed to, and when.
-- Existing accounts start empty, so they are asked on their next visit.
ALTER TABLE "users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "accepted_at" timestamp with time zone;
