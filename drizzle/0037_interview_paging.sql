-- The interview's pages (#1449): Earlier answers loads each page's facts by turn.
CREATE INDEX IF NOT EXISTS "profile_facts_turn_idx" ON "profile_facts" USING btree ("turn_id");
