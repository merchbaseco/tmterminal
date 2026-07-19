UPDATE "source_artifact"
SET
	"download_state" = CASE
		WHEN "state" IN ('complete', 'projecting') AND "object_key" IS NOT NULL THEN 'complete'::"source_artifact_download_state"
		WHEN "state" IN ('complete', 'projecting') THEN 'unavailable'::"source_artifact_download_state"
		WHEN "state" = 'failed' AND "sha256" IS NOT NULL AND "object_key" IS NOT NULL THEN 'complete'::"source_artifact_download_state"
		WHEN "state" = 'failed' AND "sha256" IS NOT NULL THEN 'unavailable'::"source_artifact_download_state"
		WHEN "state" = 'failed' THEN 'failed'::"source_artifact_download_state"
		WHEN "state" = 'downloading' THEN 'failed'::"source_artifact_download_state"
		WHEN "state" = 'pending' AND "current_error" = 'USPTO ODP download redirect failed with HTTP 429' THEN 'failed'::"source_artifact_download_state"
		ELSE 'pending'::"source_artifact_download_state"
	END,
	"download_error" = CASE
		WHEN "state" IN ('complete', 'projecting', 'failed') AND "sha256" IS NOT NULL AND "object_key" IS NULL
			THEN 'Retained ZIP unavailable from pre-retention ingestion'
		WHEN "state" = 'downloading' THEN COALESCE("current_error", 'Download interrupted before retention')
		WHEN "state" = 'failed' AND "sha256" IS NULL THEN "current_error"
		WHEN "state" = 'pending' AND "current_error" = 'USPTO ODP download redirect failed with HTTP 429' THEN "current_error"
		ELSE NULL
	END,
	"download_response_state" = CASE
		WHEN "current_error" = 'USPTO ODP download redirect failed with HTTP 429' THEN jsonb_build_object('status', 429)
		ELSE NULL
	END,
	"downloaded_at" = CASE
		WHEN "state" IN ('complete', 'projecting') OR ("state" = 'failed' AND "sha256" IS NOT NULL)
			THEN COALESCE("completed_at", "updated_at")
		ELSE NULL
	END,
	"projection_state" = CASE
		WHEN "state" = 'complete' THEN 'complete'::"source_artifact_projection_state"
		WHEN "state" = 'projecting' AND "object_key" IS NULL THEN 'failed'::"source_artifact_projection_state"
		WHEN "state" = 'projecting' THEN 'projecting'::"source_artifact_projection_state"
		WHEN "state" = 'failed' AND "sha256" IS NOT NULL THEN 'failed'::"source_artifact_projection_state"
		ELSE 'pending'::"source_artifact_projection_state"
	END,
	"projection_error" = CASE
		WHEN "state" = 'projecting' AND "object_key" IS NULL
			THEN 'Projection interrupted and retained ZIP unavailable from pre-retention ingestion'
		WHEN "state" = 'failed' AND "sha256" IS NOT NULL THEN "current_error"
		ELSE NULL
	END,
	"projection_version" = CASE
		WHEN "state" IN ('complete', 'failed') AND "sha256" IS NOT NULL THEN 'uspto-projection-v1'
		ELSE NULL
	END,
	"projection_completed_at" = CASE WHEN "state" = 'complete' THEN "completed_at" ELSE NULL END;
--> statement-breakpoint
UPDATE "source_lane"
SET "status" = 'ready', "failure_count" = 0, "current_error" = NULL,
	"next_eligible_at" = NULL, "updated_at" = now()
WHERE "id" = 'uspto-odp'
	AND "status" = 'stopped'
	AND "failure_count" IN (8, 9)
	AND "current_error" = 'USPTO ODP download redirect failed with HTTP 429'
	AND EXISTS (
		SELECT 1 FROM "source_artifact"
		WHERE "download_state" = 'failed'
			AND "download_response_state" = '{"status": 429}'::jsonb
	);
