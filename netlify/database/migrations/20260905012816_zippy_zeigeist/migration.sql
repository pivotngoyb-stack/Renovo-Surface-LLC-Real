ALTER TABLE "work_orders" ADD COLUMN "crew_token" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_crew_token_key" UNIQUE("crew_token");