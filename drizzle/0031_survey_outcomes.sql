-- Survey questions can report an outcome for Admin > Metrics (#526): an interview or an offer, and which choice means yes.
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "outcome" text;
--> statement-breakpoint
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "outcome_answer" text;
--> statement-breakpoint
UPDATE "survey_questions" SET "outcome" = 'interview', "outcome_answer" = 'Yes'
WHERE "prompt" = 'Any interviews from Lookout finds so far?' AND "kind" = 'choice' AND "options" ? 'Yes';
--> statement-breakpoint
-- A matching offers question, off until Eric turns it on, next to the seeded interviews one.
INSERT INTO "survey_questions" ("kind", "prompt", "options", "active", "outcome", "outcome_answer")
SELECT 'choice', 'Any offers from Lookout finds so far?', '["Yes", "Not yet"]'::jsonb, false, 'offer', 'Yes'
WHERE EXISTS (SELECT 1 FROM "survey_questions" WHERE "outcome" = 'interview')
  AND NOT EXISTS (SELECT 1 FROM "survey_questions" WHERE "outcome" = 'offer');
