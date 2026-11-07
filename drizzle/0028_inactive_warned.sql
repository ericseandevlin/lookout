-- Inactive accounts (#26). last_active_at keeps the last request of sessions the daily cleanup deletes;
-- inactive_warned_at is when the 12-month inactivity email went out. Deletion stays by hand.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "inactive_warned_at" timestamp with time zone;
