CREATE TYPE "bid_outcome" AS ENUM('won', 'lost', 'no_bid', 'withdrawn');--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "bid_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "bid_delivery_method" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "outcome" "bid_outcome";--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "outcome_at" timestamp;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "outcome_notes" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "lost_to_name" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "lost_to_amount" numeric;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "bidder_count" integer;