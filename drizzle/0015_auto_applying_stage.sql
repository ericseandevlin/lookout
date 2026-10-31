-- Finds with an open application move to the new Auto-applying stage (#182). Stages the user picked are left alone.
UPDATE "user_opportunities" AS uo
SET "stage" = 'Auto-applying'
FROM "applications" AS a
WHERE a."user_id" = uo."user_id"
  AND a."opportunity_id" = uo."opportunity_id"
  AND a."status" NOT IN ('submitted', 'canceled', 'failed')
  AND uo."stage" = 'Not applied';
