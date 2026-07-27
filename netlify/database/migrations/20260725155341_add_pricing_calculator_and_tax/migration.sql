ALTER TABLE "estimate_line_items" ADD COLUMN "service_type" text;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "calculator_inputs" text;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "base_price" numeric;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "final_price" numeric;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "estimated_duration_hours" numeric;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "estimated_product_cost" numeric;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "tax_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "tax_amount" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_amount" numeric DEFAULT '0' NOT NULL;