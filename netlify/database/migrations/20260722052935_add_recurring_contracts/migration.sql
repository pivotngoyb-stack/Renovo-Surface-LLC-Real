CREATE TYPE "contract_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "recurring_contracts" (
	"id" serial PRIMARY KEY,
	"client_id" integer NOT NULL,
	"description" text NOT NULL,
	"amount" numeric NOT NULL,
	"billing_day" integer NOT NULL,
	"status" "contract_status" DEFAULT 'active'::"contract_status" NOT NULL,
	"last_billed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recurring_contract_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reminder_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "last_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_contract_id_recurring_contracts_id_fkey" FOREIGN KEY ("recurring_contract_id") REFERENCES "recurring_contracts"("id");--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD CONSTRAINT "recurring_contracts_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id");