-- Personal referral links (#527): each person's code for Settings > Invite a friend, and who referred each waitlist request.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_idx" ON "users" ("referral_code");--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN IF NOT EXISTS "referred_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
