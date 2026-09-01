CREATE TYPE "change_order_status" AS ENUM('draft', 'sent', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "work_order_kind" AS ENUM('authorization', 'visit');--> statement-breakpoint
ALTER TYPE "work_order_status" ADD VALUE 'completed';--> statement-breakpoint
CREATE TABLE "change_order_line_items" (
	"id" serial PRIMARY KEY,
	"change_order_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"unit_price" numeric NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" serial PRIMARY KEY,
	"work_order_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"token" text NOT NULL UNIQUE,
	"status" "change_order_status" DEFAULT 'draft'::"change_order_status" NOT NULL,
	"description" text NOT NULL,
	"reason" text,
	"po_number" text,
	"schedule_impact_days" integer DEFAULT 0 NOT NULL,
	"signer_name" text,
	"signer_title" text,
	"signature_type" "signature_type",
	"signature_data" text,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"decline_reason" text,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"responded_at" timestamp,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "recurring_contracts" ADD COLUMN "visit_frequency" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "recurring_contract_id" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "visit_sequence" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "kind" "work_order_kind" DEFAULT 'authorization'::"work_order_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "change_order_line_items" ADD CONSTRAINT "change_order_line_items_change_order_id_change_orders_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id");--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_recurring_contract_id_recurring_contracts_id_fkey" FOREIGN KEY ("recurring_contract_id") REFERENCES "recurring_contracts"("id");