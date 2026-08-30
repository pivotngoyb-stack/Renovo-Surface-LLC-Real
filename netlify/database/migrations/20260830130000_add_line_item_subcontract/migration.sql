ALTER TABLE "estimate_line_items" ADD COLUMN "subcontracted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "subcontractor_cost" numeric;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "subcontract_coordination_pct" numeric;
