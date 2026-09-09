CREATE TABLE "bid_addenda" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"number" text NOT NULL,
	"received_at" date,
	"summary" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"affects_price" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_submittals" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"provided" boolean DEFAULT false NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bid_addenda" ADD CONSTRAINT "bid_addenda_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");--> statement-breakpoint
ALTER TABLE "bid_submittals" ADD CONSTRAINT "bid_submittals_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");