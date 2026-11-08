-- Personal connection stories (#155): true moments a cover letter can open with, tagged by theme.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "personal_stories" jsonb DEFAULT '[]'::jsonb NOT NULL;
