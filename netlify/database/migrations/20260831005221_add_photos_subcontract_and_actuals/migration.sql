CREATE TABLE "estimate_photos" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"token" text NOT NULL UNIQUE,
	"blob_key" text NOT NULL,
	"caption" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "subcontracted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "subcontractor_cost" numeric;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD COLUMN "subcontract_coordination_pct" numeric;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "actual_hours" numeric;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "actual_crew_size" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "actual_hours_note" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "actual_materials_cost" numeric;--> statement-breakpoint
ALTER TABLE "estimate_photos" ADD CONSTRAINT "estimate_photos_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");