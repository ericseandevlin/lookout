-- Current pay on the profile (#109), AES-GCM encrypted. Only for comparing posted ranges on the board.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "current_comp" text;
