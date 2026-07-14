CREATE TYPE "public"."artifact_download_state" AS ENUM('pending', 'downloading', 'verified');--> statement-breakpoint
CREATE TYPE "public"."source_alert_kind" AS ENUM('credential', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."source_attempt_kind" AS ENUM('discovery', 'download');--> statement-breakpoint
CREATE TYPE "public"."source_attempt_outcome" AS ENUM('running', 'success', 'transient_failure', 'credential_failure', 'permanent_failure');--> statement-breakpoint
CREATE TYPE "public"."source_lane_status" AS ENUM('ready', 'backoff', 'stopped');--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"filename" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_discovery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_version_id" uuid,
	"fingerprint" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"download_state" "artifact_download_state" DEFAULT 'pending' NOT NULL,
	"download_url" text NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"source_from_date" date NOT NULL,
	"source_to_date" date NOT NULL,
	"release_date" date NOT NULL,
	"source_last_modified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artifact_id" uuid NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"bytes" bigint NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_product" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"frequency" text,
	"metadata_last_modified_at" timestamp with time zone,
	"next_discovery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_alert" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lane_id" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"kind" "source_alert_kind" NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lane_id" text NOT NULL,
	"kind" "source_attempt_kind" NOT NULL,
	"product_id" text,
	"discovery_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" "source_attempt_outcome" DEFAULT 'running' NOT NULL,
	"response_state" jsonb,
	"retry_eligible_at" timestamp with time zone,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "source_lane" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "source_lane_status" DEFAULT 'ready' NOT NULL,
	"next_eligible_at" timestamp with time zone,
	"transient_failure_count" integer DEFAULT 0 NOT NULL,
	"last_response_state" jsonb,
	"stop_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_product_id_dataset_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."dataset_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_discovery" ADD CONSTRAINT "artifact_discovery_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_discovery" ADD CONSTRAINT "artifact_discovery_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_alert" ADD CONSTRAINT "source_alert_lane_id_source_lane_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."source_lane"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_alert" ADD CONSTRAINT "source_alert_attempt_id_source_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."source_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_attempt" ADD CONSTRAINT "source_attempt_lane_id_source_lane_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."source_lane"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_attempt" ADD CONSTRAINT "source_attempt_product_id_dataset_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."dataset_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_attempt" ADD CONSTRAINT "source_attempt_discovery_id_artifact_discovery_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."artifact_discovery"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_product_filename_unique" ON "artifact" USING btree ("product_id","filename");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_discovery_artifact_fingerprint_unique" ON "artifact_discovery" USING btree ("artifact_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_version_artifact_sha256_unique" ON "artifact_version" USING btree ("artifact_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "source_alert_attempt_unique" ON "source_alert" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "source_attempt_lane_started_idx" ON "source_attempt" USING btree ("lane_id","started_at");