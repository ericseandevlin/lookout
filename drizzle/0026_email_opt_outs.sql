-- Email rules (#28, CAN-SPAM). Addresses that unsubscribed from Lookout's news and waitlist mail.
-- Not tied to an account, so an opt-out outlives account deletion and a later sign-up.
CREATE TABLE "email_opt_outs" (
	"email" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- What the waitlist form told the person about email when they asked, and when.
ALTER TABLE "access_requests" ADD COLUMN "consent_version" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "consent_at" timestamp with time zone;
