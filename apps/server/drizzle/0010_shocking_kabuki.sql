CREATE TABLE "artifact_version_selection" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"retained_version_count" integer NOT NULL,
	"retained_version_fingerprint" varchar(64) NOT NULL,
	"reason" text NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_version" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD COLUMN "quarantine_reason" text;--> statement-breakpoint
ALTER TABLE "source_alert" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_alert" ADD COLUMN "resolution_reason" text;--> statement-breakpoint
ALTER TABLE "artifact_version_selection" ADD CONSTRAINT "artifact_version_selection_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_selection" ADD CONSTRAINT "artifact_version_selection_version_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE no action ON UPDATE no action;