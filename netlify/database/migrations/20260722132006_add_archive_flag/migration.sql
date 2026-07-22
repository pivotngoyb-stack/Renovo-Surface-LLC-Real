ALTER TABLE "estimates" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;