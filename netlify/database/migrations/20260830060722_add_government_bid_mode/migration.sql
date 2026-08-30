ALTER TABLE "estimates" ADD COLUMN "bid_mode" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "solicitation_number" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "option_years" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "prevailing_wage" boolean DEFAULT false NOT NULL;