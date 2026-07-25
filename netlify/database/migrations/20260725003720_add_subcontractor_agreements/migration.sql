CREATE TYPE "payment_type" AS ENUM('flat', 'percentage');--> statement-breakpoint
CREATE TYPE "sub_agreement_status" AS ENUM('pending', 'signed');--> statement-breakpoint
CREATE TABLE "subcontractor_agreements" (
	"id" serial PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"subcontractor_name" text NOT NULL,
	"subcontractor_phone" text NOT NULL,
	"subcontractor_email" text,
	"payment_type" "payment_type" NOT NULL,
	"payment_amount" numeric,
	"payment_percentage" numeric,
	"status" "sub_agreement_status" DEFAULT 'pending'::"sub_agreement_status" NOT NULL,
	"signer_name" text,
	"signature_type" "signature_type",
	"signature_data" text,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"signed_at" timestamp,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
