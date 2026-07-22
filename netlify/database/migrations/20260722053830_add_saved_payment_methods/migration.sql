ALTER TABLE "clients" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD COLUMN "auto_charge_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD COLUMN "stripe_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD COLUMN "card_last4" text;