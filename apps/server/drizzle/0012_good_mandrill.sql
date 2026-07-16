DO $$
DECLARE
	cutover_complete boolean := false;
BEGIN
	IF EXISTS (SELECT 1 FROM "artifact_version") THEN
		IF to_regclass('public.prd77_cutover_proof') IS NOT NULL THEN
			EXECUTE 'SELECT EXISTS (
				SELECT 1 FROM prd77_cutover_proof
				WHERE proof = ''artifact-lifecycle-v1''
			)' INTO cutover_complete;
		END IF;
		IF NOT cutover_complete THEN
			RAISE EXCEPTION 'Object lifecycle migration requires completed PRD-77 offline cutover';
		END IF;
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "artifact_version" ALTER COLUMN "object_key" DROP NOT NULL;--> statement-breakpoint
UPDATE "artifact_version" SET "object_key" = NULL;--> statement-breakpoint
DROP TABLE IF EXISTS "prd77_cutover_proof";
