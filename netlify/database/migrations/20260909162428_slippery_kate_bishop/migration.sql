ALTER TABLE "estimates" ADD COLUMN "wage_determination_number" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "wage_classification" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "wage_base_rate" numeric;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "wage_fringe_rate" numeric;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "wage_fringe_mode" text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "wage_decision_date" date;