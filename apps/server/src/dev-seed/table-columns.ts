/**
 * Column declarations for each seeded table, in FK-safe write order. The
 * writer feeds them to `jsonb_to_recordset`, so the declared type is what
 * casts each JSON value into the column — enum columns therefore name their
 * PostgreSQL enum type rather than `text`, because there is no implicit cast
 * from text into an enum on insert.
 *
 * `mark.search_status` and `mark.word_mark_normalized` are absent by design:
 * both are GENERATED ALWAYS, so the seed sets `status_code` and `word_mark`
 * and lets the database derive the rest, exactly as ingestion does.
 */

export const seedTableColumns = {
  account: {
    created_at: "timestamptz",
    id: "uuid",
    merchbase_user_id: "text",
    name: "text",
    search_preferences: "jsonb",
  },
  data_state: {
    id: "text",
    last_successful_update_at: "timestamptz",
    version: "bigint",
  },
  mark: {
    filing_date: "date",
    mark_drawing_code: "text",
    normalization_version: "text",
    registration_date: "date",
    registration_number: "text",
    serial_number: "text",
    source_content_revision: "integer",
    source_filename: "text",
    source_parser_version: "text",
    source_physical_record_index: "integer",
    source_product: "text",
    source_sha256: "text",
    source_snapshot_hash: "text",
    source_transaction_date: "date",
    status_code: "text",
    status_date: "date",
    word_mark: "text",
  },
  mark_class: {
    international_code: "text",
    ordinal: "integer",
    serial_number: "text",
    source_filename: "text",
    source_physical_record_index: "integer",
    source_product: "text",
    source_sha256: "text",
    status_code: "text",
    status_date: "date",
  },
  mark_goods_services: {
    ordinal: "integer",
    serial_number: "text",
    source_filename: "text",
    source_physical_record_index: "integer",
    source_product: "text",
    source_sha256: "text",
    text: "text",
    type_code: "text",
  },
  mark_owner: {
    entry_number: "text",
    ordinal: "integer",
    party_name: "text",
    party_type: "text",
    serial_number: "text",
    source_filename: "text",
    source_physical_record_index: "integer",
    source_product: "text",
    source_sha256: "text",
  },
  mark_status_event: {
    code: "text",
    description: "text",
    event_date: "date",
    event_key: "text",
    event_number: "text",
    serial_number: "text",
    source_filename: "text",
    source_physical_record_index: "integer",
    source_product: "text",
    source_sha256: "text",
    type: "text",
  },
  source_artifact: {
    application_completed_at: "timestamptz",
    application_state: "source_artifact_application_state",
    applied_record_count: "integer",
    bytes: "bigint",
    content_revision: "integer",
    current_error: "text",
    download_request_count: "integer",
    download_response_state: "jsonb",
    download_state: "source_artifact_download_state_v2",
    downloaded_at: "timestamptz",
    expected_bytes: "bigint",
    filename: "text",
    id: "uuid",
    object_key: "text",
    parser_version: "text",
    physical_record_count: "integer",
    processing_disposition: "source_artifact_processing_disposition",
    product: "text",
    projected_mark_count: "integer",
    sha256: "text",
    source_from_date: "date",
    source_to_date: "date",
    unresolved_record_count: "integer",
    updated_at: "timestamptz",
  },
  trademark_recency: {
    content_revision: "integer",
    parser_version: "text",
    serial_number: "text",
    snapshot_hash: "text",
    source_filename: "text",
    source_physical_record_index: "integer",
    source_product: "text",
    source_sha256: "text",
    source_transaction_date: "date",
    updated_at: "timestamptz",
  },
  worker_status: {
    activity: "worker_activity",
    current_error: "text",
    current_filename: "text",
    id: "text",
    last_discovery_at: "timestamptz",
    last_heartbeat_at: "timestamptz",
    updated_at: "timestamptz",
  },
} as const satisfies Record<string, Record<string, string>>;

export type SeedTableName = keyof typeof seedTableColumns;

/** Insert order, chosen so every foreign key already has its parent row. */
export const seedTableOrder: SeedTableName[] = [
  "account",
  "data_state",
  "worker_status",
  "source_artifact",
  "mark",
  "mark_class",
  "mark_owner",
  "mark_goods_services",
  "mark_status_event",
  "trademark_recency",
];

/**
 * Clear order for a re-run. The four `mark_*` child tables cascade from `mark`
 * but are deleted explicitly so the reset is legible rather than implied.
 * `account` is absent: the seed owns only its own account row and removes that
 * one by owner and by its own deterministic id, so a developer's Clerk-created
 * account and its saved search preferences survive a re-seed. `role_assignment`
 * is absent for the same reason — the writer re-grants the operator role
 * instead.
 */
export const seedClearOrder: string[] = [
  "mark_status_event",
  "mark_goods_services",
  "mark_owner",
  "mark_class",
  "trademark_recency",
  "mark",
  "source_artifact",
  "worker_status",
  "data_state",
];
