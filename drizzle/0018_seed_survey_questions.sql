-- Seed questions for one-question beta surveys (#37, feature #5). They start OFF: Eric turns each on in Admin > Surveys.
-- People are asked the oldest active question they haven't answered, so created_at sets the order.
-- Skipped if any question already exists, so a fresh admin setup isn't overwritten.
INSERT INTO "survey_questions" ("kind", "prompt", "options", "active", "created_at")
SELECT q.kind, q.prompt, q.options::jsonb, false, now() + (q.n || ' seconds')::interval
FROM (VALUES
  (1, 'scale',  'How good were this week''s matches?', '[]'),
  (2, 'choice', 'Did a Lookout find lead to an application this week?', '["Yes", "No", "Not applying this week"]'),
  (3, 'choice', 'Any interviews from Lookout finds so far?', '["Yes", "Not yet"]'),
  (4, 'choice', 'Do you use the email, the site, or both?', '["Mostly the email", "Mostly the site", "Both"]'),
  (5, 'text',   'What''s one thing you''d change?', '[]')
) AS q(n, kind, prompt, options)
WHERE NOT EXISTS (SELECT 1 FROM "survey_questions");
