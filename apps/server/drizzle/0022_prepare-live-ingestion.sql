DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "source_artifact"
		WHERE "projection_state" <> 'complete'
	) THEN
		RAISE EXCEPTION 'live-ingestion cutover requires every legacy source artifact to be complete';
	END IF;
END $$;
--> statement-breakpoint
UPDATE "source_artifact"
SET "download_state" = 'complete'
WHERE "projection_state" = 'complete';
--> statement-breakpoint
UPDATE "source_artifact"
SET "download_state" = 'failed'
WHERE "download_state" = 'unavailable';
--> statement-breakpoint
ALTER TYPE "public"."source_artifact_download_state" RENAME VALUE 'complete' TO 'downloaded';
--> statement-breakpoint
ALTER TYPE "public"."source_artifact_download_state" RENAME VALUE 'failed' TO 'blocked';
--> statement-breakpoint
ALTER TYPE "public"."source_artifact_projection_state" RENAME VALUE 'projecting' TO 'applying';
--> statement-breakpoint
ALTER TYPE "public"."source_artifact_projection_state" RENAME VALUE 'failed' TO 'needs_attention';
