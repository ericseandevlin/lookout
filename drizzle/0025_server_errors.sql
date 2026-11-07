-- Error tracking (#12): unexpected server errors, searchable in Admin > Errors, kept 30 days.
CREATE TABLE "server_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"path" text,
	"method" text,
	"digest" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "server_errors_at_idx" ON "server_errors" USING btree ("at");
