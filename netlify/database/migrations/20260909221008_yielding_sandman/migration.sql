ALTER TABLE "lien_notices" ADD COLUMN "project_type" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "lien_notices" ADD COLUMN "bond_notice_due" date;--> statement-breakpoint
ALTER TABLE "lien_notices" ADD COLUMN "bond_notice_filed_at" date;--> statement-breakpoint
ALTER TABLE "lien_notices" ADD COLUMN "bond_reference" text;