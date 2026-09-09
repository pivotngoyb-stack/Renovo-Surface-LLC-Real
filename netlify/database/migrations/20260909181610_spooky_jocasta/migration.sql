CREATE TYPE "scope_line_kind" AS ENUM('scope', 'exclusion', 'assumption', 'clarification');--> statement-breakpoint
CREATE TABLE "estimate_scope_lines" (
	"id" serial PRIMARY KEY,
	"estimate_id" integer NOT NULL,
	"kind" "scope_line_kind" NOT NULL,
	"text" text NOT NULL,
	"suppress" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimate_scope_lines" ADD CONSTRAINT "estimate_scope_lines_estimate_id_estimates_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id");