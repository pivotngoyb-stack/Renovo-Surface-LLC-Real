CREATE TABLE "estimate_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"estimate_id" integer NOT NULL,
	"token" text NOT NULL,
	"blob_key" text NOT NULL,
	"caption" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_photos_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "estimate_photos" ADD CONSTRAINT "estimate_photos_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE no action ON UPDATE no action;
