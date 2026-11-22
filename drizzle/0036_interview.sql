-- The interview (#1449): what Lookout knows about a person, one fact per row, and the questions it asked.
-- Both go with the account (on delete cascade).
CREATE TABLE IF NOT EXISTS "interview_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"topic" text NOT NULL,
	"question" text NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"setup_key" text,
	"parent_id" uuid,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interview_turns_user_idx" ON "interview_turns" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"quote" text DEFAULT '' NOT NULL,
	"turn_id" uuid REFERENCES "interview_turns"("id") ON DELETE set null,
	"setup_key" text,
	"shareable" boolean DEFAULT true NOT NULL,
	"lock_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_facts_user_idx" ON "profile_facts" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "facts_imported_at" timestamp with time zone;
