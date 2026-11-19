-- The stage a find was at when the link check closed it, so a repost can bring back one they hadn't applied to (#922).
ALTER TABLE "user_opportunities" ADD COLUMN IF NOT EXISTS "closed_from" text;
