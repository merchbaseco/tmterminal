DROP TABLE "artifact" CASCADE;--> statement-breakpoint
DROP TABLE "artifact_discovery" CASCADE;--> statement-breakpoint
DROP TABLE "artifact_version" CASCADE;--> statement-breakpoint
DROP TABLE "artifact_version_selection" CASCADE;--> statement-breakpoint
DROP TABLE "corpus_event" CASCADE;--> statement-breakpoint
DROP TABLE "corpus_state" CASCADE;--> statement-breakpoint
DROP TABLE "dataset_product" CASCADE;--> statement-breakpoint
DROP TABLE "mark" CASCADE;--> statement-breakpoint
DROP TABLE "mark_class" CASCADE;--> statement-breakpoint
DROP TABLE "mark_goods_services" CASCADE;--> statement-breakpoint
DROP TABLE "mark_group_contributor" CASCADE;--> statement-breakpoint
DROP TABLE "mark_owner" CASCADE;--> statement-breakpoint
DROP TABLE "mark_status_event" CASCADE;--> statement-breakpoint
DROP TABLE "parse_reject" CASCADE;--> statement-breakpoint
DROP TABLE "parse_run" CASCADE;--> statement-breakpoint
DROP TABLE "publication" CASCADE;--> statement-breakpoint
DROP TABLE "publication_artifact" CASCADE;--> statement-breakpoint
DROP TABLE "publication_diagnostic" CASCADE;--> statement-breakpoint
DROP TABLE "source_alert" CASCADE;--> statement-breakpoint
DROP TABLE "source_attempt" CASCADE;--> statement-breakpoint
DROP TABLE "source_claim" CASCADE;--> statement-breakpoint
DROP TABLE "source_record" CASCADE;--> statement-breakpoint
ALTER TABLE "source_lane" ADD COLUMN "current_error" text;--> statement-breakpoint
ALTER TABLE "source_lane" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "source_lane" SET "failure_count" = "transient_failure_count", "current_error" = "stop_reason";--> statement-breakpoint
ALTER TABLE "source_lane" DROP COLUMN "transient_failure_count";--> statement-breakpoint
ALTER TABLE "source_lane" DROP COLUMN "last_response_state";--> statement-breakpoint
ALTER TABLE "source_lane" DROP COLUMN "stop_reason";--> statement-breakpoint
DROP TYPE "public"."artifact_download_state";--> statement-breakpoint
DROP TYPE "public"."artifact_version_state";--> statement-breakpoint
DROP TYPE "public"."parse_run_state";--> statement-breakpoint
DROP TYPE "public"."publication_diagnostic_kind";--> statement-breakpoint
DROP TYPE "public"."publication_state";--> statement-breakpoint
DROP TYPE "public"."source_alert_kind";--> statement-breakpoint
DROP TYPE "public"."source_attempt_kind";--> statement-breakpoint
DROP TYPE "public"."source_attempt_outcome";--> statement-breakpoint
DROP TYPE "public"."source_claim_operation";
