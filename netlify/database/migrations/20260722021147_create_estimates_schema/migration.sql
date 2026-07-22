CREATE TYPE "estimate_status" AS ENUM('draft', 'sent', 'viewed', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "signature_type" AS ENUM('drawn', 'typed');--> statement-breakpoint
CREATE TYPE "work_order_status" AS ENUM('pending', 'signed');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"property_address" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_line_items" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"unit_price" numeric NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" serial PRIMARY KEY,
	"client_id" integer NOT NULL,
	"token" text NOT NULL UNIQUE,
	"status" "estimate_status" DEFAULT 'draft'::"estimate_status" NOT NULL,
	"notes" text,
	"valid_until" date,
	"viewed_at" timestamp,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" serial PRIMARY KEY,
	"work_order_id" integer NOT NULL,
	"signer_name" text NOT NULL,
	"signature_type" "signature_type" NOT NULL,
	"signature_data" text NOT NULL,
	"consent_confirmed" boolean NOT NULL,
	"ip_address" text,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"token" text NOT NULL UNIQUE,
	"terms_text" text NOT NULL,
	"status" "work_order_status" DEFAULT 'pending'::"work_order_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id");--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");