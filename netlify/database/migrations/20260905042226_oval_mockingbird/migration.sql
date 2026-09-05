CREATE TYPE "photo_source" AS ENUM('office', 'crew');--> statement-breakpoint
ALTER TABLE "work_order_photos" ADD COLUMN "source" "photo_source" DEFAULT 'office'::"photo_source" NOT NULL;