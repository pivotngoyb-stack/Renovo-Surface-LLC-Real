ALTER TABLE "signatures" ADD COLUMN "terms_agreed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "service_type_shown" text;