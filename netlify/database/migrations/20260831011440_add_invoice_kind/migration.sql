CREATE TYPE "invoice_kind" AS ENUM('full', 'deposit', 'balance');--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" "invoice_kind" DEFAULT 'full'::"invoice_kind" NOT NULL;