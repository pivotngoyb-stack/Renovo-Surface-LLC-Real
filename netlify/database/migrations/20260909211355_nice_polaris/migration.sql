CREATE TABLE "lien_notices" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL UNIQUE,
	"first_work_date" date,
	"preliminary_filed_at" date,
	"preliminary_reference" text,
	"completion_date" date,
	"lien_filed_at" date,
	"waived" boolean DEFAULT false NOT NULL,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lien_notices" ADD CONSTRAINT "lien_notices_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");