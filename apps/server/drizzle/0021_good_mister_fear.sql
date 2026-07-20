ALTER TABLE "source_artifact" ADD COLUMN "download_request_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "source_artifact"
SET "download_request_count" = 1
WHERE "download_state" <> 'pending';--> statement-breakpoint
UPDATE "source_artifact"
SET "download_state" = 'complete', "download_error" = NULL
WHERE "download_state" = 'unavailable'
  AND "projection_state" = 'complete'
  AND "sha256" IS NOT NULL;
