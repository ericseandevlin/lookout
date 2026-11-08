-- Survey questions about the email are only asked of people whose summary email is on (#514).
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "only_if_digest" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "survey_questions" SET "prompt" = 'Do you read your Lookout new-matches email, use the site, or both?', "options" = '["Mostly the email", "Mostly the site", "Both"]'::jsonb, "only_if_digest" = true
WHERE "prompt" = 'Do you use the email, the site, or both?';
--> statement-breakpoint
UPDATE "survey_questions" SET "prompt" = 'What''s one thing you''d change about Lookout?'
WHERE "prompt" = 'What''s one thing you''d change?';
