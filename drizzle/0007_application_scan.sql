ALTER TABLE "application_items" ADD COLUMN "field_type" text;--> statement-breakpoint
ALTER TABLE "application_items" ADD COLUMN "options" jsonb;--> statement-breakpoint
ALTER TABLE "application_items" ADD COLUMN "question" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "report" jsonb DEFAULT '{}'::jsonb NOT NULL;