CREATE TYPE "public"."source_artifact_processing_disposition" AS ENUM('required', 'deferred', 'covered');--> statement-breakpoint
CREATE TYPE "public"."worker_activity" AS ENUM('idle', 'discovering', 'downloading', 'applying');--> statement-breakpoint
ALTER TYPE "public"."source_artifact_projection_state" RENAME TO "source_artifact_application_state";--> statement-breakpoint
ALTER TYPE "public"."source_artifact_download_state" RENAME TO "source_artifact_download_state_v2";--> statement-breakpoint
CREATE TABLE "trademark_recency" (
	"content_revision" integer NOT NULL,
	"parser_version" text NOT NULL,
	"serial_number" text PRIMARY KEY NOT NULL,
	"snapshot_hash" varchar(64) NOT NULL,
	"source_filename" text NOT NULL,
	"source_physical_record_index" integer NOT NULL,
	"source_product" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"source_transaction_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_status" (
	"activity" "worker_activity" DEFAULT 'idle' NOT NULL,
	"current_error" text,
	"current_filename" text,
	"id" text PRIMARY KEY NOT NULL,
	"last_discovery_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_lane" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "source_lane" CASCADE;--> statement-breakpoint
ALTER TABLE "source_artifact" RENAME COLUMN "projection_completed_at" TO "application_completed_at";--> statement-breakpoint
ALTER TABLE "source_artifact" RENAME COLUMN "projection_state" TO "application_state";--> statement-breakpoint
ALTER TABLE "source_artifact" RENAME COLUMN "projection_error" TO "current_error";--> statement-breakpoint
ALTER TABLE "source_artifact" RENAME COLUMN "projection_version" TO "parser_version";--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "download_state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "download_state" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."source_artifact_download_state_v2";--> statement-breakpoint
CREATE TYPE "public"."source_artifact_download_state_v2" AS ENUM('pending', 'downloading', 'downloaded', 'blocked');--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "download_state" SET DEFAULT 'pending'::"public"."source_artifact_download_state_v2";--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "download_state" SET DATA TYPE "public"."source_artifact_download_state_v2" USING "download_state"::"public"."source_artifact_download_state_v2";--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "application_state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "application_state" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."source_artifact_application_state";--> statement-breakpoint
CREATE TYPE "public"."source_artifact_application_state" AS ENUM('pending', 'applying', 'complete', 'needs_attention');--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "application_state" SET DEFAULT 'pending'::"public"."source_artifact_application_state";--> statement-breakpoint
ALTER TABLE "source_artifact" ALTER COLUMN "application_state" SET DATA TYPE "public"."source_artifact_application_state" USING "application_state"::"public"."source_artifact_application_state";--> statement-breakpoint
DROP INDEX "source_artifact_projection_state_filename_idx";--> statement-breakpoint
ALTER TABLE "mark" ADD COLUMN "source_content_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mark" ADD COLUMN "source_parser_version" text DEFAULT 'uspto-projection-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "mark" ADD COLUMN "source_snapshot_hash" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "applied_record_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "content_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "processing_disposition" "source_artifact_processing_disposition" DEFAULT 'required' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "selected_broad_from_date" date;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "selected_broad_to_date" date;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD COLUMN "unresolved_record_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "source_artifact_application_state_filename_idx" ON "source_artifact" USING btree ("application_state","filename");--> statement-breakpoint
CREATE INDEX "source_artifact_queue_idx" ON "source_artifact" USING btree ("processing_disposition","download_state","source_to_date","source_from_date","filename");--> statement-breakpoint
ALTER TABLE "data_state" DROP COLUMN "complete_through_date";--> statement-breakpoint
ALTER TABLE "source_artifact" DROP COLUMN "download_error";--> statement-breakpoint
ALTER TABLE "source_artifact" DROP COLUMN "download_url";--> statement-breakpoint
DROP TYPE "public"."source_lane_status";