-- Where each waitlist request came from (#527), so Admin > Metrics can count signups per channel.
ALTER TABLE "access_requests" ADD COLUMN IF NOT EXISTS "channel" text;
