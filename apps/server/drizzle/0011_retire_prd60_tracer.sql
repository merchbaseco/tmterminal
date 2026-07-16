SELECT pg_advisory_xact_lock(hashtext('tmturtle-corpus-publication'));--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "corpus_state") OR EXISTS (SELECT 1 FROM "publication") THEN
		RAISE EXCEPTION 'Class 025 cutover requires no durable corpus or publication';
	END IF;
END
$$;--> statement-breakpoint
DELETE FROM "mark"
WHERE "serial_number" = '60146682'
	AND EXISTS (
		SELECT 1 FROM "artifact"
		WHERE "product_id" = 'TRTYRAP'
			AND "filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml'
	);--> statement-breakpoint
DELETE FROM "source_claim" claim
USING "source_record" record, "parse_run" run, "artifact_version" version, "artifact"
WHERE claim."source_record_id" = record."id"
	AND record."parse_run_id" = run."id"
	AND run."artifact_version_id" = version."id"
	AND version."artifact_id" = artifact."id"
	AND artifact."product_id" = 'TRTYRAP'
	AND artifact."filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml';--> statement-breakpoint
DELETE FROM "source_record" record
USING "parse_run" run, "artifact_version" version, "artifact"
WHERE record."parse_run_id" = run."id"
	AND run."artifact_version_id" = version."id"
	AND version."artifact_id" = artifact."id"
	AND artifact."product_id" = 'TRTYRAP'
	AND artifact."filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml';--> statement-breakpoint
DELETE FROM "parse_reject" reject
USING "parse_run" run, "artifact_version" version, "artifact"
WHERE reject."parse_run_id" = run."id"
	AND run."artifact_version_id" = version."id"
	AND version."artifact_id" = artifact."id"
	AND artifact."product_id" = 'TRTYRAP'
	AND artifact."filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml';--> statement-breakpoint
DELETE FROM "parse_run" run
USING "artifact_version" version, "artifact"
WHERE run."artifact_version_id" = version."id"
	AND version."artifact_id" = artifact."id"
	AND artifact."product_id" = 'TRTYRAP'
	AND artifact."filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml';--> statement-breakpoint
DELETE FROM "artifact_version_selection" selection
USING "artifact"
WHERE selection."artifact_id" = artifact."id"
	AND artifact."product_id" = 'TRTYRAP'
	AND artifact."filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml';--> statement-breakpoint
DELETE FROM "artifact_version" version
USING "artifact"
WHERE version."artifact_id" = artifact."id"
	AND artifact."product_id" = 'TRTYRAP'
	AND artifact."filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml';--> statement-breakpoint
DELETE FROM "artifact"
WHERE "product_id" = 'TRTYRAP'
	AND "filename" = 'prd-60-tracer-annual-2025-full-tx-60146682.xml';--> statement-breakpoint
DELETE FROM "source_claim" claim
USING "source_record" record, "parse_run" run, "artifact_version" version
WHERE claim."source_record_id" = record."id"
	AND record."parse_run_id" = run."id"
	AND run."artifact_version_id" = version."id"
	AND run."parser_version" <> 'uspto-application-xml-v3'
	AND run."state" <> 'quarantined'
	AND version."state" <> 'quarantined';--> statement-breakpoint
DELETE FROM "source_record" record
USING "parse_run" run, "artifact_version" version
WHERE record."parse_run_id" = run."id"
	AND run."artifact_version_id" = version."id"
	AND run."parser_version" <> 'uspto-application-xml-v3'
	AND run."state" <> 'quarantined'
	AND version."state" <> 'quarantined';--> statement-breakpoint
DELETE FROM "parse_run" run
USING "artifact_version" version
WHERE run."artifact_version_id" = version."id"
	AND run."parser_version" <> 'uspto-application-xml-v3'
	AND run."state" <> 'quarantined'
	AND version."state" <> 'quarantined';--> statement-breakpoint
UPDATE "artifact_version" version SET "state" = 'verified'
WHERE version."state" IN ('staged', 'published')
	AND EXISTS (
		SELECT 1 FROM "artifact_discovery" discovery
		WHERE discovery."artifact_version_id" = version."id"
			AND discovery."download_state" = 'verified'
	)
	AND NOT EXISTS (
		SELECT 1 FROM "parse_run" run
		WHERE run."artifact_version_id" = version."id"
			AND run."parser_version" = 'uspto-application-xml-v3'
	);
