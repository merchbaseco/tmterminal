ALTER TABLE "publication" ADD COLUMN "source_fingerprint" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "parent_publication_id" uuid;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "parser_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "authority_policy_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "projection_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "normalization_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "source_profile_version" text NOT NULL;