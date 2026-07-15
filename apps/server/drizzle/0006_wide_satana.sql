ALTER TABLE "publication_artifact" ADD COLUMN "discovery_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_artifact" ADD COLUMN "source_from_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_artifact" ADD COLUMN "source_to_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_artifact" ADD CONSTRAINT "publication_artifact_discovery_id_artifact_discovery_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."artifact_discovery"("id") ON DELETE no action ON UPDATE no action;