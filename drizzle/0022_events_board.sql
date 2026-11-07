ALTER TABLE "networking_events" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "networking_events" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "networking_events" ADD COLUMN "fit" integer;--> statement-breakpoint
ALTER TABLE "networking_events" ADD COLUMN "miles" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "event_freq" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "events_searched_at" timestamp with time zone;