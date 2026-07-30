CREATE TYPE "payment_method" AS ENUM('cash', 'check', 'card', 'stripe', 'other');--> statement-breakpoint
CREATE TYPE "photo_category" AS ENUM('before', 'after');--> statement-breakpoint
ALTER TYPE "invoice_status" ADD VALUE 'partially_paid' BEFORE 'paid';--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" serial PRIMARY KEY,
	"invoice_id" integer NOT NULL,
	"amount" numeric NOT NULL,
	"method" "payment_method" NOT NULL,
	"stripe_payment_intent_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_payments" (
	"id" serial PRIMARY KEY,
	"subcontractor_agreement_id" integer NOT NULL,
	"amount" numeric NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_date" date NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_photos" (
	"id" serial PRIMARY KEY,
	"work_order_id" integer NOT NULL,
	"token" text NOT NULL UNIQUE,
	"blob_key" text NOT NULL,
	"category" "photo_category" NOT NULL,
	"caption" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_Wep38axESWUQ_fkey" FOREIGN KEY ("subcontractor_agreement_id") REFERENCES "subcontractor_agreements"("id");--> statement-breakpoint
ALTER TABLE "work_order_photos" ADD CONSTRAINT "work_order_photos_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_stripe_pi_idx" ON "invoice_payments" ("stripe_payment_intent_id") WHERE "stripe_payment_intent_id" IS NOT NULL;