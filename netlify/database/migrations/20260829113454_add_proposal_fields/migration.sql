ALTER TABLE "estimate_line_items" ADD COLUMN "is_optional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "project_name" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "site_address" text;