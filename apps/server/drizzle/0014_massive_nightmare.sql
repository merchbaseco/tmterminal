CREATE TYPE "public"."corpus_generation_state" AS ENUM('building', 'active');--> statement-breakpoint
CREATE TYPE "public"."source_artifact_state" AS ENUM('pending', 'downloading', 'projecting', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "corpus_event" (
	"corpus_version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generation_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_generation" (
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_artifact_count" integer NOT NULL,
	"from_date" date NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"product" text NOT NULL,
	"state" "corpus_generation_state" DEFAULT 'building' NOT NULL,
	"to_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_state" (
	"complete_through_date" date,
	"corpus_version" bigint DEFAULT 0 NOT NULL,
	"current_generation_id" uuid,
	"id" text PRIMARY KEY NOT NULL,
	"last_successful_merge_at" timestamp with time zone,
	"published_through_date" date
);
--> statement-breakpoint
CREATE TABLE "mark" (
	"filing_date" date,
	"generation_id" uuid NOT NULL,
	"mark_drawing_code" text,
	"normalization_version" text NOT NULL,
	"registration_date" date,
	"registration_number" text,
	"search_status" text GENERATED ALWAYS AS (case status_code when '000' then 'unknown' when '400' then 'dead' when '401' then 'dead' when '402' then 'dead' when '403' then 'dead' when '404' then 'dead' when '405' then 'dead' when '406' then 'dead' when '410' then 'live' when '411' then 'dead' when '412' then 'dead' when '413' then 'live' when '414' then 'dead' when '415' then 'dead' when '416' then 'dead' when '417' then 'dead' when '600' then 'dead' when '601' then 'dead' when '602' then 'dead' when '603' then 'dead' when '604' then 'dead' when '605' then 'dead' when '606' then 'dead' when '607' then 'dead' when '608' then 'dead' when '609' then 'dead' when '610' then 'dead' when '612' then 'dead' when '614' then 'dead' when '616' then 'live' when '618' then 'dead' when '620' then 'live' when '622' then 'unknown' when '624' then 'live' when '625' then 'live' when '626' then 'dead' when '630' then 'live' when '631' then 'live' when '632' then 'dead' when '638' then 'live' when '640' then 'live' when '641' then 'live' when '642' then 'live' when '643' then 'live' when '644' then 'live' when '645' then 'live' when '646' then 'live' when '647' then 'live' when '648' then 'live' when '649' then 'live' when '650' then 'live' when '651' then 'live' when '652' then 'live' when '653' then 'live' when '654' then 'live' when '655' then 'live' when '656' then 'live' when '657' then 'live' when '658' then 'live' when '659' then 'live' when '660' then 'live' when '661' then 'live' when '663' then 'live' when '664' then 'live' when '665' then 'live' when '666' then 'live' when '667' then 'live' when '668' then 'live' when '672' then 'live' when '680' then 'live' when '681' then 'live' when '682' then 'live' when '686' then 'live' when '688' then 'live' when '689' then 'live' when '690' then 'live' when '692' then 'live' when '693' then 'live' when '694' then 'live' when '700' then 'live' when '701' then 'live' when '702' then 'live' when '703' then 'live' when '704' then 'live' when '705' then 'live' when '706' then 'live' when '707' then 'live' when '708' then 'live' when '709' then 'dead' when '710' then 'dead' when '711' then 'dead' when '712' then 'dead' when '713' then 'dead' when '714' then 'dead' when '715' then 'unknown' when '717' then 'live' when '718' then 'live' when '719' then 'live' when '720' then 'live' when '721' then 'live' when '722' then 'live' when '724' then 'live' when '725' then 'live' when '730' then 'live' when '731' then 'live' when '732' then 'live' when '733' then 'live' when '734' then 'live' when '739' then 'live' when '740' then 'live' when '744' then 'live' when '745' then 'live' when '746' then 'live' when '748' then 'live' when '752' then 'live' when '753' then 'live' when '756' then 'live' when '757' then 'live' when '760' then 'live' when '762' then 'live' when '763' then 'live' when '764' then 'live' when '765' then 'live' when '766' then 'live' when '771' then 'live' when '772' then 'live' when '773' then 'live' when '774' then 'live' when '775' then 'live' when '777' then 'live' when '778' then 'live' when '779' then 'live' when '780' then 'live' when '781' then 'dead' when '782' then 'dead' when '783' then 'dead' when '790' then 'live' when '794' then 'live' when '800' then 'live' when '801' then 'live' when '802' then 'live' when '803' then 'live' when '804' then 'live' when '806' then 'live' when '807' then 'live' when '808' then 'live' when '809' then 'live' when '810' then 'live' when '811' then 'live' when '812' then 'live' when '813' then 'live' when '814' then 'live' when '815' then 'live' when '816' then 'live' when '817' then 'live' when '818' then 'live' when '819' then 'live' when '820' then 'live' when '821' then 'live' when '822' then 'live' when '823' then 'live' when '824' then 'live' when '825' then 'live' when '900' then 'dead' when '901' then 'dead' when '968' then 'dead' when '969' then 'live' when '970' then 'unknown' when '973' then 'live' else 'unknown' end) STORED,
	"serial_number" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_physical_record_index" integer NOT NULL,
	"source_product" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"source_transaction_date" date,
	"status_code" text,
	"status_date" date,
	"word_mark" text NOT NULL,
	"word_mark_normalized" text GENERATED ALWAYS AS (lower(normalize(btrim(word_mark), NFKC) collate "und-x-icu") collate "default") STORED,
	CONSTRAINT "mark_generation_id_serial_number_pk" PRIMARY KEY("generation_id","serial_number")
);
--> statement-breakpoint
CREATE TABLE "mark_class" (
	"generation_id" uuid NOT NULL,
	"international_code" text,
	"ordinal" integer NOT NULL,
	"serial_number" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_physical_record_index" integer NOT NULL,
	"source_product" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"status_code" text,
	"status_date" date,
	CONSTRAINT "mark_class_generation_id_serial_number_ordinal_pk" PRIMARY KEY("generation_id","serial_number","ordinal")
);
--> statement-breakpoint
CREATE TABLE "mark_goods_services" (
	"generation_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"serial_number" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_physical_record_index" integer NOT NULL,
	"source_product" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"text" text,
	"type_code" text,
	CONSTRAINT "mark_goods_services_generation_id_serial_number_ordinal_pk" PRIMARY KEY("generation_id","serial_number","ordinal")
);
--> statement-breakpoint
CREATE TABLE "mark_owner" (
	"entry_number" text,
	"generation_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"party_name" text,
	"party_type" text,
	"serial_number" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_physical_record_index" integer NOT NULL,
	"source_product" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	CONSTRAINT "mark_owner_generation_id_serial_number_ordinal_pk" PRIMARY KEY("generation_id","serial_number","ordinal")
);
--> statement-breakpoint
CREATE TABLE "mark_status_event" (
	"code" text,
	"description" text,
	"event_date" date,
	"event_key" varchar(64) NOT NULL,
	"event_number" text,
	"generation_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_physical_record_index" integer NOT NULL,
	"source_product" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"type" text,
	CONSTRAINT "mark_status_event_generation_id_serial_number_event_key_pk" PRIMARY KEY("generation_id","serial_number","event_key")
);
--> statement-breakpoint
CREATE TABLE "source_artifact" (
	"bytes" bigint,
	"completed_at" timestamp with time zone,
	"current_error" text,
	"download_url" text NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"filename" text NOT NULL,
	"generation_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"object_key" text,
	"physical_record_count" integer DEFAULT 0 NOT NULL,
	"product" text NOT NULL,
	"projected_mark_count" integer DEFAULT 0 NOT NULL,
	"sha256" varchar(64),
	"source_from_date" date NOT NULL,
	"source_to_date" date NOT NULL,
	"state" "source_artifact_state" DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corpus_event" ADD CONSTRAINT "corpus_event_generation_id_corpus_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."corpus_generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_state" ADD CONSTRAINT "corpus_state_current_generation_id_corpus_generation_id_fk" FOREIGN KEY ("current_generation_id") REFERENCES "public"."corpus_generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_generation_id_corpus_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."corpus_generation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_class" ADD CONSTRAINT "mark_class_generation_id_serial_number_mark_generation_id_serial_number_fk" FOREIGN KEY ("generation_id","serial_number") REFERENCES "public"."mark"("generation_id","serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_goods_services" ADD CONSTRAINT "mark_goods_services_generation_id_serial_number_mark_generation_id_serial_number_fk" FOREIGN KEY ("generation_id","serial_number") REFERENCES "public"."mark"("generation_id","serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_owner" ADD CONSTRAINT "mark_owner_generation_id_serial_number_mark_generation_id_serial_number_fk" FOREIGN KEY ("generation_id","serial_number") REFERENCES "public"."mark"("generation_id","serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_status_event" ADD CONSTRAINT "mark_status_event_generation_id_serial_number_mark_generation_id_serial_number_fk" FOREIGN KEY ("generation_id","serial_number") REFERENCES "public"."mark"("generation_id","serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifact" ADD CONSTRAINT "source_artifact_generation_id_corpus_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."corpus_generation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_event_generation_kind_unique" ON "corpus_event" USING btree ("generation_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_generation_product_dates_unique" ON "corpus_generation" USING btree ("product","from_date","to_date");--> statement-breakpoint
CREATE UNIQUE INDEX "mark_generation_registration_number_unique" ON "mark" USING btree ("generation_id","registration_number") WHERE "mark"."registration_number" is not null;--> statement-breakpoint
CREATE INDEX "mark_generation_word_mark_exact_idx" ON "mark" USING btree ("generation_id","word_mark_normalized");--> statement-breakpoint
CREATE INDEX "mark_word_mark_normalized_trgm_idx" ON "mark" USING gin ("word_mark_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "mark_live_generation_word_mark_exact_idx" ON "mark" USING btree ("generation_id","word_mark_normalized") WHERE "mark"."search_status" = 'live';--> statement-breakpoint
CREATE INDEX "mark_live_word_mark_normalized_trgm_idx" ON "mark" USING gin ("word_mark_normalized" gin_trgm_ops) WHERE "mark"."search_status" = 'live';--> statement-breakpoint
CREATE UNIQUE INDEX "source_artifact_generation_filename_unique" ON "source_artifact" USING btree ("generation_id","filename");--> statement-breakpoint
CREATE UNIQUE INDEX "source_artifact_product_filename_sha_unique" ON "source_artifact" USING btree ("product","filename","sha256");--> statement-breakpoint
CREATE INDEX "source_artifact_generation_state_idx" ON "source_artifact" USING btree ("generation_id","state","filename");