UPDATE "mark"
SET
	"source_content_revision" = 1,
	"source_parser_version" = 'uspto-projection-v1',
	"source_snapshot_hash" = repeat('0', 64);
--> statement-breakpoint
UPDATE "source_artifact"
SET "applied_record_count" = "physical_record_count"
WHERE "application_state" = 'complete';
--> statement-breakpoint
INSERT INTO "trademark_recency" (
	"content_revision",
	"parser_version",
	"serial_number",
	"snapshot_hash",
	"source_filename",
	"source_physical_record_index",
	"source_product",
	"source_sha256",
	"source_transaction_date"
)
SELECT
	1,
	'uspto-projection-v1',
	"serial_number",
	repeat('0', 64),
	"source_filename",
	"source_physical_record_index",
	"source_product",
	"source_sha256",
	"source_transaction_date"
FROM "mark"
WHERE "source_transaction_date" IS NOT NULL
ON CONFLICT ("serial_number") DO NOTHING;
--> statement-breakpoint
INSERT INTO "worker_status" ("id", "activity")
VALUES ('uspto', 'idle')
ON CONFLICT ("id") DO NOTHING;
