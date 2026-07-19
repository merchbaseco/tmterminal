CREATE TYPE "public"."source_artifact_download_state" AS ENUM('pending', 'downloading', 'complete', 'failed', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."source_artifact_projection_state" AS ENUM('pending', 'projecting', 'complete', 'failed');--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "download_error" text;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "download_response_state" jsonb;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "download_state" "source_artifact_download_state" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "downloaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "projection_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "projection_error" text;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "projection_state" "source_artifact_projection_state" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "projection_version" text;--> statement-breakpoint
CREATE INDEX "source_artifact_download_state_filename_idx" ON "source_artifact" USING btree ("download_state","filename");--> statement-breakpoint
CREATE INDEX "source_artifact_projection_state_filename_idx" ON "source_artifact" USING btree ("projection_state","filename");