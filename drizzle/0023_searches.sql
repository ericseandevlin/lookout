-- One account can hold several searches (#8): a searches table, and the single
-- implicit search every account had moves onto it. kind, answers, autofilled,
-- saved_at and the built search profile leave profiles, which keeps only what is
-- per-account (apply answers, skill notes, EEO, master resume, event interests).
CREATE TABLE "searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'job' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"autofilled" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"saved_at" timestamp with time zone,
	"search_profile" jsonb,
	"search_profile_at" timestamp with time zone,
	"search_profile_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "searches_user_idx" ON "searches" USING btree ("user_id");--> statement-breakpoint
-- Every existing account gets one search, moved off its profile row.
INSERT INTO "searches" ("user_id", "name", "kind", "answers", "autofilled", "saved_at", "search_profile", "search_profile_at", "search_profile_hash")
SELECT p."user_id",
	CASE WHEN p."kind" = 'rfp' THEN 'RFP search' ELSE 'Job search' END,
	p."kind", p."answers", p."autofilled", p."saved_at", p."search_profile", p."search_profile_at", p."search_profile_hash"
FROM "profiles" p;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "active_search_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_active_search_id_searches_id_fk" FOREIGN KEY ("active_search_id") REFERENCES "public"."searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "settings" s SET "active_search_id" = x."id" FROM "searches" x WHERE x."user_id" = s."user_id";--> statement-breakpoint
-- Runs belong to a search (resume scans stay account-level: search_id null).
ALTER TABLE "runs" ADD COLUMN "search_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "runs" r SET "search_id" = x."id" FROM "searches" x WHERE x."user_id" = r."user_id";--> statement-breakpoint
-- The board is per search: one row per (search, opportunity), so the same posting
-- can sit on two boards. user_id stays for account-wide queries.
ALTER TABLE "user_opportunities" ADD COLUMN "search_id" uuid;--> statement-breakpoint
ALTER TABLE "user_opportunities" ADD CONSTRAINT "user_opportunities_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "user_opportunities" u SET "search_id" = x."id" FROM "searches" x WHERE x."user_id" = u."user_id";--> statement-breakpoint
ALTER TABLE "user_opportunities" ALTER COLUMN "search_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_opportunities" DROP CONSTRAINT "user_opportunities_user_id_opportunity_id_pk";--> statement-breakpoint
ALTER TABLE "user_opportunities" ADD CONSTRAINT "user_opportunities_search_id_opportunity_id_pk" PRIMARY KEY ("search_id","opportunity_id");--> statement-breakpoint
CREATE INDEX "user_opportunities_user_idx" ON "user_opportunities" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "answers";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "autofilled";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "saved_at";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "search_profile";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "search_profile_at";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "search_profile_hash";