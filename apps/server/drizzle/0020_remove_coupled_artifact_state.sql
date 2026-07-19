DROP INDEX "source_artifact_state_filename_idx";--> statement-breakpoint
ALTER TABLE "source_artifact" DROP COLUMN "completed_at";--> statement-breakpoint
ALTER TABLE "source_artifact" DROP COLUMN "current_error";--> statement-breakpoint
ALTER TABLE "source_artifact" DROP COLUMN "state";--> statement-breakpoint
DROP TYPE "public"."source_artifact_state";