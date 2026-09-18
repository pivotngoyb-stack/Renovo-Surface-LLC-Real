CREATE TABLE "site_access" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL UNIQUE,
	"entry_method" text,
	"entry_details" text,
	"alarm_details" text,
	"pets" text,
	"parking" text,
	"instructions" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD COLUMN "work_order_id" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "subcontractor_agreement_id" integer;--> statement-breakpoint
ALTER TABLE "site_access" ADD CONSTRAINT "site_access_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_DuNTtbzdVP0o_fkey" FOREIGN KEY ("subcontractor_agreement_id") REFERENCES "subcontractor_agreements"("id");