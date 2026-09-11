CREATE TYPE "pay_app_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "pay_application_lines" (
	"id" serial PRIMARY KEY,
	"pay_application_id" integer NOT NULL,
	"sov_line_id" integer NOT NULL,
	"this_pct" numeric DEFAULT '0' NOT NULL,
	"stored_materials" numeric DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"scheduled_value" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_applications" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"number" integer NOT NULL,
	"period_to" date,
	"retainage_pct" numeric DEFAULT '0' NOT NULL,
	"total_completed" numeric DEFAULT '0' NOT NULL,
	"retainage" numeric DEFAULT '0' NOT NULL,
	"total_earned_less_retainage" numeric DEFAULT '0' NOT NULL,
	"less_previous_certificates" numeric DEFAULT '0' NOT NULL,
	"current_payment_due" numeric DEFAULT '0' NOT NULL,
	"status" "pay_app_status" DEFAULT 'draft'::"pay_app_status" NOT NULL,
	"invoice_id" integer,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sov_lines" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"description" text NOT NULL,
	"scheduled_value" numeric NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_application_lines" ADD CONSTRAINT "pay_application_lines_wV0IPSR8WoOc_fkey" FOREIGN KEY ("pay_application_id") REFERENCES "pay_applications"("id");--> statement-breakpoint
ALTER TABLE "pay_application_lines" ADD CONSTRAINT "pay_application_lines_sov_line_id_sov_lines_id_fkey" FOREIGN KEY ("sov_line_id") REFERENCES "sov_lines"("id");--> statement-breakpoint
ALTER TABLE "pay_applications" ADD CONSTRAINT "pay_applications_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");--> statement-breakpoint
ALTER TABLE "pay_applications" ADD CONSTRAINT "pay_applications_invoice_id_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");--> statement-breakpoint
ALTER TABLE "sov_lines" ADD CONSTRAINT "sov_lines_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");