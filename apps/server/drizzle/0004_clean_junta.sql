CREATE TABLE "mark" (
	"serial_number" text PRIMARY KEY NOT NULL,
	"registration_number" text,
	"word_mark" text,
	"mark_drawing_code" text,
	"filing_date" date,
	"registration_date" date,
	"status_code" text,
	"status_date" date,
	"source_transaction_date" date,
	"normalization_version" text NOT NULL,
	"source_profile_version" text NOT NULL,
	"projection_version" text NOT NULL,
	"authority_policy_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mark_class" (
	"serial_number" text NOT NULL,
	"ordinal" integer NOT NULL,
	"international_code" text,
	"status_code" text,
	"status_date" date,
	CONSTRAINT "mark_class_serial_number_ordinal_pk" PRIMARY KEY("serial_number","ordinal")
);
--> statement-breakpoint
CREATE TABLE "mark_goods_services" (
	"serial_number" text NOT NULL,
	"ordinal" integer NOT NULL,
	"type_code" text,
	"text" text,
	CONSTRAINT "mark_goods_services_serial_number_ordinal_pk" PRIMARY KEY("serial_number","ordinal")
);
--> statement-breakpoint
CREATE TABLE "mark_group_contributor" (
	"serial_number" text NOT NULL,
	"group_name" text NOT NULL,
	"claim_path" text NOT NULL,
	"product" text NOT NULL,
	"artifact_version_sha256" varchar(64) NOT NULL,
	"physical_record_index" integer NOT NULL,
	CONSTRAINT "mark_group_contributor_pk" PRIMARY KEY("serial_number","group_name","claim_path","product","artifact_version_sha256","physical_record_index")
);
--> statement-breakpoint
CREATE TABLE "mark_owner" (
	"serial_number" text NOT NULL,
	"ordinal" integer NOT NULL,
	"entry_number" text,
	"party_name" text,
	"party_type" text,
	CONSTRAINT "mark_owner_serial_number_ordinal_pk" PRIMARY KEY("serial_number","ordinal")
);
--> statement-breakpoint
CREATE TABLE "mark_status_event" (
	"serial_number" text NOT NULL,
	"event_key" varchar(64) NOT NULL,
	"code" text,
	"type" text,
	"description" text,
	"event_date" date,
	"event_number" text,
	CONSTRAINT "mark_status_event_serial_number_event_key_pk" PRIMARY KEY("serial_number","event_key")
);
--> statement-breakpoint
ALTER TABLE "mark_class" ADD CONSTRAINT "mark_class_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_goods_services" ADD CONSTRAINT "mark_goods_services_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_group_contributor" ADD CONSTRAINT "mark_group_contributor_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_owner" ADD CONSTRAINT "mark_owner_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_status_event" ADD CONSTRAINT "mark_status_event_serial_number_mark_serial_number_fk" FOREIGN KEY ("serial_number") REFERENCES "public"."mark"("serial_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mark_registration_number_unique" ON "mark" USING btree ("registration_number") WHERE "mark"."registration_number" is not null;