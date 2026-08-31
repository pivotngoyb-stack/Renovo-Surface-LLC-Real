CREATE TABLE "estimate_signatures" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"signer_name" text NOT NULL,
	"signer_title" text,
	"signature_type" "signature_type" NOT NULL,
	"signature_data" text NOT NULL,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_signatures" ADD CONSTRAINT "estimate_signatures_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");