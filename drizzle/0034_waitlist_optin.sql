-- Waitlist double opt-in and "what would you search for" (#9).
ALTER TABLE "access_requests" ADD COLUMN IF NOT EXISTS "search_for" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
