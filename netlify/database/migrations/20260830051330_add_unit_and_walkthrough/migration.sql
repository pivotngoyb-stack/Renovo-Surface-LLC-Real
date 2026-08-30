ALTER TABLE "estimate_line_items" ADD COLUMN "unit" text DEFAULT 'job' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "walkthrough_date" date;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "site_conditions" text;