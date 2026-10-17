ALTER TABLE "profiles" ADD COLUMN "eeo" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "eeo_consent" boolean DEFAULT false NOT NULL;