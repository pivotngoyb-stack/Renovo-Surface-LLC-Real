ALTER TABLE "work_orders" ADD COLUMN "actual_hours" numeric;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "actual_crew_size" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "actual_hours_note" text;
