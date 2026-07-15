CREATE TYPE "public"."publication_diagnostic_kind" AS ENUM('authority-conflict', 'unsupported-semantics');--> statement-breakpoint
CREATE TYPE "public"."publication_state" AS ENUM('staged', 'rejected', 'published');--> statement-breakpoint
CREATE TABLE "corpus_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"publication_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"corpus_version" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_state" (
	"id" text PRIMARY KEY NOT NULL,
	"published_through_date" date,
	"complete_through_date" date,
	"last_successful_merge_at" timestamp with time zone,
	"corpus_version" bigint DEFAULT 0 NOT NULL,
	"publication_id" uuid
);
--> statement-breakpoint
CREATE TABLE "publication" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"state" "publication_state" DEFAULT 'staged' NOT NULL,
	"artifact_count" integer NOT NULL,
	"published_through_date" date,
	"complete_through_date" date,
	"corpus_version" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	CONSTRAINT "publication_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "publication_artifact" (
	"publication_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"artifact_version_sha256" varchar(64) NOT NULL,
	"parse_run_id" uuid NOT NULL,
	"parse_run_digest" varchar(64) NOT NULL,
	"selected_explicitly" boolean DEFAULT false NOT NULL,
	CONSTRAINT "publication_artifact_publication_id_artifact_id_pk" PRIMARY KEY("publication_id","artifact_id")
);
--> statement-breakpoint
CREATE TABLE "publication_diagnostic" (
	"publication_id" uuid NOT NULL,
	"diagnostic_key" varchar(64) NOT NULL,
	"kind" "publication_diagnostic_kind" NOT NULL,
	"serial_number" text NOT NULL,
	"details" jsonb NOT NULL,
	CONSTRAINT "publication_diagnostic_publication_id_diagnostic_key_pk" PRIMARY KEY("publication_id","diagnostic_key")
);
--> statement-breakpoint
ALTER TABLE "corpus_event" ADD CONSTRAINT "corpus_event_publication_id_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_state" ADD CONSTRAINT "corpus_state_publication_id_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_artifact" ADD CONSTRAINT "publication_artifact_publication_id_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_artifact" ADD CONSTRAINT "publication_artifact_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_artifact" ADD CONSTRAINT "publication_artifact_artifact_version_id_artifact_version_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_artifact" ADD CONSTRAINT "publication_artifact_parse_run_id_parse_run_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_diagnostic" ADD CONSTRAINT "publication_diagnostic_publication_id_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_event_publication_kind_unique" ON "corpus_event" USING btree ("publication_id","kind");