CREATE TABLE "access_projection" (
	"access" text,
	"access_valid_until" timestamp with time zone,
	"issuer" text NOT NULL,
	"merchbase_user_id" text,
	"source_updated_at" bigint NOT NULL,
	"subject" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_projection_issuer_subject_pk" PRIMARY KEY("issuer","subject"),
	CONSTRAINT "access_projection_state_check" CHECK ((
        ("access_projection"."merchbase_user_id" is null and "access_projection"."access" is null and "access_projection"."access_valid_until" is null)
        or
        ("access_projection"."merchbase_user_id" is not null and "access_projection"."access" in ('granted', 'not_granted'))
      ))
);
--> statement-breakpoint
CREATE TABLE "access_projection_receipt" (
	"event_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "merchbase_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "access_projection_merchbase_user_id_unique" ON "access_projection" USING btree ("merchbase_user_id") WHERE "access_projection"."merchbase_user_id" is not null;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_merchbase_user_id_unique" UNIQUE("merchbase_user_id");