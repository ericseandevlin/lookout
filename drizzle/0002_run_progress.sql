ALTER TABLE "runs" ADD COLUMN "progress" jsonb DEFAULT '{"pct":0,"step":"","log":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "request" jsonb;