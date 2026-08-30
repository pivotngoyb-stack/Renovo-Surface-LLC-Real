ALTER TABLE "work_orders" ADD COLUMN "scheduled_date" date;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "scheduled_start" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "completed_at" timestamp;