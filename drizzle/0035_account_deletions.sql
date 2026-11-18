-- Deleted account ids, so a restored backup can delete them again (#1342). Id and time only.
CREATE TABLE IF NOT EXISTS "account_deletions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
