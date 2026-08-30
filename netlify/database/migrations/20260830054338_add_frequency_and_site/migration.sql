ALTER TABLE "estimate_line_items" ADD COLUMN "frequency" text DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "site_name" text;