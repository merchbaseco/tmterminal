CREATE TYPE "public"."artifact_version_state" AS ENUM('verified', 'parsing', 'staged', 'quarantined', 'published');--> statement-breakpoint
CREATE TYPE "public"."parse_run_state" AS ENUM('parsing', 'staged', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."source_claim_operation" AS ENUM('set', 'clear', 'replace', 'assert');--> statement-breakpoint
CREATE TABLE "parse_reject" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parse_run_id" uuid NOT NULL,
	"physical_record_index" integer,
	"reason" text NOT NULL,
	"raw_xml" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parse_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"state" "parse_run_state" DEFAULT 'parsing' NOT NULL,
	"parser_version" text NOT NULL,
	"digest" varchar(64),
	"record_count" integer DEFAULT 0 NOT NULL,
	"reject_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_record_id" uuid NOT NULL,
	"claim_order" integer NOT NULL,
	"path" text NOT NULL,
	"occurrence" integer NOT NULL,
	"presence" text NOT NULL,
	"operation" "source_claim_operation",
	"raw_value" text
);
--> statement-breakpoint
CREATE TABLE "source_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parse_run_id" uuid NOT NULL,
	"physical_record_index" integer NOT NULL,
	"action_key" text NOT NULL,
	"action_occurrence" integer NOT NULL,
	"action_record_index" integer NOT NULL,
	"serial_number" text NOT NULL,
	"source_transaction_date" date,
	"source_transaction_date_raw" text,
	"schema_version" text NOT NULL,
	"schema_version_date" text NOT NULL,
	"profile" text NOT NULL,
	"digest" varchar(64) NOT NULL,
	"values" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_version" ADD COLUMN "state" "artifact_version_state" DEFAULT 'verified' NOT NULL;--> statement-breakpoint
ALTER TABLE "parse_reject" ADD CONSTRAINT "parse_reject_parse_run_id_parse_run_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_run" ADD CONSTRAINT "parse_run_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_claim" ADD CONSTRAINT "source_claim_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_parse_run_id_parse_run_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parse_run_artifact_parser_unique" ON "parse_run" USING btree ("artifact_version_id","parser_version");--> statement-breakpoint
CREATE UNIQUE INDEX "source_claim_record_order_unique" ON "source_claim" USING btree ("source_record_id","claim_order");--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_run_position_unique" ON "source_record" USING btree ("parse_run_id","physical_record_index");--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_action_position_unique" ON "source_record" USING btree ("parse_run_id","action_key","action_occurrence","action_record_index");--> statement-breakpoint
CREATE INDEX "source_record_serial_idx" ON "source_record" USING btree ("serial_number");