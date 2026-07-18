DO $$
DECLARE
	generation_count integer;
	sole_generation uuid;
BEGIN
	SELECT count(*) INTO generation_count FROM corpus_generation;
	SELECT id INTO sole_generation FROM corpus_generation LIMIT 1;
	IF generation_count = 0 THEN
		IF EXISTS (SELECT 1 FROM source_artifact) OR EXISTS (SELECT 1 FROM mark) THEN
			RAISE EXCEPTION 'live-data cutover found rows without a generation';
		END IF;
	ELSIF generation_count = 1 THEN
		IF NOT EXISTS (
			SELECT 1 FROM corpus_generation
			WHERE id = sole_generation AND product = 'TRTYRAP' AND state = 'building'
				AND from_date = '1884-04-07' AND to_date = '2025-12-31'
				AND expected_artifact_count = 91
		) THEN
			RAISE EXCEPTION 'live-data cutover requires the sole annual building generation';
		END IF;
		IF (SELECT count(*) FROM source_artifact WHERE generation_id = sole_generation) <> 91
			OR (SELECT count(*) FROM source_artifact WHERE generation_id = sole_generation AND state = 'complete') <> 25
			OR (SELECT count(*) FROM source_artifact WHERE generation_id = sole_generation AND state = 'pending') <> 65
			OR (SELECT count(*) FROM source_artifact WHERE generation_id = sole_generation AND state = 'projecting') <> 1
			OR EXISTS (SELECT 1 FROM source_artifact WHERE generation_id <> sole_generation)
		THEN
			RAISE EXCEPTION 'live-data cutover source artifacts do not match the stopped Parts 01-26 production shape';
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM source_artifact
			WHERE generation_id = sole_generation
				AND filename = 'apc18840407-20251231-26.zip'
				AND state = 'projecting'
				AND sha256 = '15f42e5355652e3c70a2b3e4bc8d39f411c6e90c050ae5c89ace1d2b92266738'
				AND object_key IS NOT NULL
		) THEN
			RAISE EXCEPTION 'live-data cutover requires the retained Part 26 artifact';
		END IF;
		IF EXISTS (SELECT 1 FROM corpus_state WHERE current_generation_id IS NOT NULL)
			OR EXISTS (SELECT 1 FROM corpus_event)
			OR EXISTS (SELECT 1 FROM mark WHERE generation_id <> sole_generation)
		THEN
			RAISE EXCEPTION 'live-data cutover found unexpected activated or multi-generation state';
		END IF;
	ELSE
		RAISE EXCEPTION 'live-data cutover does not support multiple generations';
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "data_state" (
	"complete_through_date" date,
	"id" text PRIMARY KEY NOT NULL,
	"last_successful_update_at" timestamp with time zone,
	"version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO "data_state" ("id", "last_successful_update_at", "version")
SELECT 'uspto', max("completed_at"), CASE WHEN EXISTS (SELECT 1 FROM "mark") THEN 1 ELSE 0 END
FROM "source_artifact";
--> statement-breakpoint
ALTER TABLE "mark" DROP CONSTRAINT "mark_generation_id_corpus_generation_id_fk";
--> statement-breakpoint
ALTER TABLE "mark_class" DROP CONSTRAINT "mark_class_generation_id_serial_number_mark_generation_id_serial_number_fk";
--> statement-breakpoint
ALTER TABLE "mark_goods_services" DROP CONSTRAINT "mark_goods_services_generation_id_serial_number_mark_generation_id_serial_number_fk";
--> statement-breakpoint
ALTER TABLE "mark_owner" DROP CONSTRAINT "mark_owner_generation_id_serial_number_mark_generation_id_serial_number_fk";
--> statement-breakpoint
ALTER TABLE "mark_status_event" DROP CONSTRAINT "mark_status_event_generation_id_serial_number_mark_generation_id_serial_number_fk";
--> statement-breakpoint
ALTER TABLE "source_artifact" DROP CONSTRAINT "source_artifact_generation_id_corpus_generation_id_fk";
--> statement-breakpoint
DROP INDEX "mark_generation_registration_number_unique";
--> statement-breakpoint
DROP INDEX "mark_generation_word_mark_exact_idx";
--> statement-breakpoint
DROP INDEX "mark_live_generation_word_mark_exact_idx";
--> statement-breakpoint
DROP INDEX "source_artifact_generation_filename_unique";
--> statement-breakpoint
DROP INDEX "source_artifact_product_filename_sha_unique";
--> statement-breakpoint
DROP INDEX "source_artifact_generation_state_idx";
--> statement-breakpoint
ALTER TABLE "mark" DROP CONSTRAINT "mark_generation_id_serial_number_pk";
--> statement-breakpoint
ALTER TABLE "mark_class" DROP CONSTRAINT "mark_class_generation_id_serial_number_ordinal_pk";
--> statement-breakpoint
ALTER TABLE "mark_goods_services" DROP CONSTRAINT "mark_goods_services_generation_id_serial_number_ordinal_pk";
--> statement-breakpoint
ALTER TABLE "mark_owner" DROP CONSTRAINT "mark_owner_generation_id_serial_number_ordinal_pk";
--> statement-breakpoint
ALTER TABLE "mark_status_event" DROP CONSTRAINT "mark_status_event_generation_id_serial_number_event_key_pk";
--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_serial_number_pk" PRIMARY KEY("serial_number");
--> statement-breakpoint
ALTER TABLE "mark_class" ADD CONSTRAINT "mark_class_serial_number_ordinal_pk" PRIMARY KEY("serial_number","ordinal");
--> statement-breakpoint
ALTER TABLE "mark_goods_services" ADD CONSTRAINT "mark_goods_services_serial_number_ordinal_pk" PRIMARY KEY("serial_number","ordinal");
--> statement-breakpoint
ALTER TABLE "mark_owner" ADD CONSTRAINT "mark_owner_serial_number_ordinal_pk" PRIMARY KEY("serial_number","ordinal");
--> statement-breakpoint
ALTER TABLE "mark_status_event" ADD CONSTRAINT "mark_status_event_serial_number_event_key_pk" PRIMARY KEY("serial_number","event_key");
--> statement-breakpoint
ALTER TABLE "mark" DROP COLUMN "generation_id";
--> statement-breakpoint
ALTER TABLE "mark_class" DROP COLUMN "generation_id";
--> statement-breakpoint
ALTER TABLE "mark_goods_services" DROP COLUMN "generation_id";
--> statement-breakpoint
ALTER TABLE "mark_owner" DROP COLUMN "generation_id";
--> statement-breakpoint
ALTER TABLE "mark_status_event" DROP COLUMN "generation_id";
--> statement-breakpoint
ALTER TABLE "source_artifact" DROP COLUMN "generation_id";
--> statement-breakpoint
ALTER TABLE "mark_class" ADD CONSTRAINT "mark_class_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mark_goods_services" ADD CONSTRAINT "mark_goods_services_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mark_owner" ADD CONSTRAINT "mark_owner_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mark_status_event" ADD CONSTRAINT "mark_status_event_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mark_registration_number_unique" ON "mark" USING btree ("registration_number") WHERE "mark"."registration_number" is not null;
--> statement-breakpoint
CREATE INDEX "mark_word_mark_exact_idx" ON "mark" USING btree ("word_mark_normalized");
--> statement-breakpoint
CREATE INDEX "mark_live_word_mark_exact_idx" ON "mark" USING btree ("word_mark_normalized") WHERE "mark"."search_status" = 'live';
--> statement-breakpoint
CREATE UNIQUE INDEX "source_artifact_product_filename_unique" ON "source_artifact" USING btree ("product","filename");
--> statement-breakpoint
CREATE INDEX "source_artifact_state_filename_idx" ON "source_artifact" USING btree ("state","filename");
--> statement-breakpoint
DROP TABLE "corpus_event";
--> statement-breakpoint
DROP TABLE "corpus_state";
--> statement-breakpoint
DROP TABLE "corpus_generation";
--> statement-breakpoint
DROP TYPE "public"."corpus_generation_state";
