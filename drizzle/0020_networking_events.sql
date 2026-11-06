-- Networking events (#7): meetups, panels and talks the sweep finds, kept apart from job finds; plus what to look for on the profile.
CREATE TABLE "networking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"time" text DEFAULT '' NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"cost" text DEFAULT '' NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"fingerprint" text NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "event_interests" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "event_reach" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "event_miles" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "networking_events" ADD CONSTRAINT "networking_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "networking_events_user_fp_idx" ON "networking_events" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "networking_events_user_starts_idx" ON "networking_events" USING btree ("user_id","starts_on");