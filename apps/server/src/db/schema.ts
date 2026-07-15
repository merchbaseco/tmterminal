import {
  bigint,
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { markSearchStatusSql } from "../search/status-policy.ts";

export const artifactDownloadState = pgEnum("artifact_download_state", ["pending", "downloading", "verified"]);
export const sourceLaneStatus = pgEnum("source_lane_status", ["ready", "backoff", "stopped"]);
export const sourceAttemptKind = pgEnum("source_attempt_kind", ["discovery", "download"]);
export const sourceAttemptOutcome = pgEnum("source_attempt_outcome", [
  "running",
  "success",
  "transient_failure",
  "credential_failure",
  "permanent_failure",
]);
export const sourceAlertKind = pgEnum("source_alert_kind", ["credential", "permanent"]);
export const artifactVersionState = pgEnum("artifact_version_state", [
  "verified",
  "parsing",
  "staged",
  "quarantined",
  "published",
]);
export const parseRunState = pgEnum("parse_run_state", ["parsing", "staged", "quarantined"]);
export const sourceClaimOperation = pgEnum("source_claim_operation", ["set", "clear", "replace", "assert"]);
export const publicationState = pgEnum("publication_state", ["staged", "rejected", "published"]);
export const publicationDiagnosticKind = pgEnum("publication_diagnostic_kind", [
  "authority-conflict",
  "unsupported-semantics",
]);
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const account = pgTable("account", {
  id: uuid("id").primaryKey(),
  name: varchar("name", { length: 80 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clerkIdentity = pgTable(
  "clerk_identity",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("clerk_identity_account_id_unique").on(table.accountId)],
);

export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    name: varchar("name", { length: 80 }).notNull(),
    secretHash: varchar("secret_hash", { length: 64 }).notNull(),
    suffix: varchar("suffix", { length: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("api_key_account_id_idx").on(table.accountId)],
);

export const roleAssignment = pgTable(
  "role_assignment",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.role] })],
);

export const sourceLane = pgTable("source_lane", {
  id: text("id").primaryKey(),
  status: sourceLaneStatus("status").notNull().default("ready"),
  nextEligibleAt: timestamp("next_eligible_at", { withTimezone: true }),
  transientFailureCount: integer("transient_failure_count").notNull().default(0),
  lastResponseState: jsonb("last_response_state").$type<Record<string, unknown>>(),
  stopReason: text("stop_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetProduct = pgTable("dataset_product", {
  id: text("id").primaryKey(),
  title: text("title"),
  frequency: text("frequency"),
  metadataLastModifiedAt: timestamp("metadata_last_modified_at", { withTimezone: true }),
  nextDiscoveryAt: timestamp("next_discovery_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artifact = pgTable(
  "artifact",
  {
    id: uuid("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => datasetProduct.id),
    filename: text("filename").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("artifact_product_filename_unique").on(table.productId, table.filename)],
);

export const artifactVersion = pgTable(
  "artifact_version",
  {
    id: uuid("id").primaryKey(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    objectKey: text("object_key").notNull(),
    state: artifactVersionState("state").notNull().default("verified"),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
    quarantineReason: text("quarantine_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("artifact_version_artifact_sha256_unique").on(table.artifactId, table.sha256)],
);

export const artifactVersionSelection = pgTable(
  "artifact_version_selection",
  {
    artifactId: uuid("artifact_id")
      .primaryKey()
      .references(() => artifact.id),
    artifactVersionId: uuid("artifact_version_id").notNull(),
    retainedVersionCount: integer("retained_version_count").notNull(),
    retainedVersionFingerprint: varchar("retained_version_fingerprint", { length: 64 }).notNull(),
    reason: text("reason").notNull(),
    selectedAt: timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [foreignKey({
    columns: [table.artifactVersionId],
    foreignColumns: [artifactVersion.id],
    name: "artifact_version_selection_version_fk",
  })],
);

export type SourceValue = {
  name: string;
  presence: "empty" | "group" | "value";
  rawValue?: string;
  children?: SourceValue[];
};

export const parseRun = pgTable(
  "parse_run",
  {
    id: uuid("id").primaryKey(),
    artifactVersionId: uuid("artifact_version_id")
      .notNull()
      .references(() => artifactVersion.id),
    state: parseRunState("state").notNull().default("parsing"),
    parserVersion: text("parser_version").notNull(),
    digest: varchar("digest", { length: 64 }),
    recordCount: integer("record_count").notNull().default(0),
    rejectCount: integer("reject_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("parse_run_artifact_parser_unique").on(table.artifactVersionId, table.parserVersion)],
);

export const sourceRecord = pgTable(
  "source_record",
  {
    id: uuid("id").primaryKey(),
    parseRunId: uuid("parse_run_id")
      .notNull()
      .references(() => parseRun.id),
    physicalRecordIndex: integer("physical_record_index").notNull(),
    actionKey: text("action_key").notNull(),
    actionOccurrence: integer("action_occurrence").notNull(),
    actionRecordIndex: integer("action_record_index").notNull(),
    serialNumber: text("serial_number").notNull(),
    sourceTransactionDate: date("source_transaction_date"),
    sourceTransactionDateRaw: text("source_transaction_date_raw"),
    schemaVersion: text("schema_version").notNull(),
    schemaVersionDate: text("schema_version_date").notNull(),
    profile: text("profile").notNull(),
    digest: varchar("digest", { length: 64 }).notNull(),
    values: jsonb("values").$type<SourceValue[]>().notNull(),
  },
  (table) => [
    uniqueIndex("source_record_run_position_unique").on(table.parseRunId, table.physicalRecordIndex),
    uniqueIndex("source_record_action_position_unique").on(
      table.parseRunId,
      table.actionKey,
      table.actionOccurrence,
      table.actionRecordIndex,
    ),
    index("source_record_serial_idx").on(table.serialNumber),
  ],
);

export const sourceClaim = pgTable(
  "source_claim",
  {
    id: uuid("id").primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecord.id),
    claimOrder: integer("claim_order").notNull(),
    path: text("path").notNull(),
    occurrence: integer("occurrence").notNull(),
    presence: text("presence").notNull(),
    operation: sourceClaimOperation("operation"),
    rawValue: text("raw_value"),
  },
  (table) => [uniqueIndex("source_claim_record_order_unique").on(table.sourceRecordId, table.claimOrder)],
);

export const parseReject = pgTable("parse_reject", {
  id: uuid("id").primaryKey(),
  parseRunId: uuid("parse_run_id")
    .notNull()
    .references(() => parseRun.id),
  physicalRecordIndex: integer("physical_record_index"),
  reason: text("reason").notNull(),
  rawXml: bytea("raw_xml").notNull(),
  bytes: integer("bytes").notNull(),
  digest: varchar("digest", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artifactDiscovery = pgTable(
  "artifact_discovery",
  {
    id: uuid("id").primaryKey(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id),
    artifactVersionId: uuid("artifact_version_id").references(() => artifactVersion.id),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    downloadState: artifactDownloadState("download_state").notNull().default("pending"),
    downloadUrl: text("download_url").notNull(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    sourceFromDate: date("source_from_date").notNull(),
    sourceToDate: date("source_to_date").notNull(),
    releaseDate: date("release_date").notNull(),
    sourceLastModifiedAt: timestamp("source_last_modified_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("artifact_discovery_artifact_fingerprint_unique").on(table.artifactId, table.fingerprint)],
);

export const sourceAttempt = pgTable(
  "source_attempt",
  {
    id: uuid("id").primaryKey(),
    laneId: text("lane_id")
      .notNull()
      .references(() => sourceLane.id),
    kind: sourceAttemptKind("kind").notNull(),
    productId: text("product_id").references(() => datasetProduct.id),
    discoveryId: uuid("discovery_id").references(() => artifactDiscovery.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: sourceAttemptOutcome("outcome").notNull().default("running"),
    responseState: jsonb("response_state").$type<Record<string, unknown>>(),
    retryEligibleAt: timestamp("retry_eligible_at", { withTimezone: true }),
    errorCode: text("error_code"),
  },
  (table) => [index("source_attempt_lane_started_idx").on(table.laneId, table.startedAt)],
);

export const sourceAlert = pgTable(
  "source_alert",
  {
    id: uuid("id").primaryKey(),
    laneId: text("lane_id")
      .notNull()
      .references(() => sourceLane.id),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => sourceAttempt.id),
    kind: sourceAlertKind("kind").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionReason: text("resolution_reason"),
  },
  (table) => [uniqueIndex("source_alert_attempt_unique").on(table.attemptId)],
);

export const mark = pgTable(
  "mark",
  {
    serialNumber: text("serial_number").primaryKey(),
    registrationNumber: text("registration_number"),
    wordMark: text("word_mark"),
    wordMarkNormalized: text("word_mark_normalized")
      .generatedAlwaysAs(sql`lower(normalize(btrim(word_mark), NFKC) collate "und-x-icu") collate "default"`),
    markDrawingCode: text("mark_drawing_code"),
    filingDate: date("filing_date"),
    registrationDate: date("registration_date"),
    statusCode: text("status_code"),
    searchStatus: text("search_status").generatedAlwaysAs(markSearchStatusSql),
    statusDate: date("status_date"),
    sourceTransactionDate: date("source_transaction_date"),
    normalizationVersion: text("normalization_version").notNull(),
    sourceProfileVersion: text("source_profile_version").notNull(),
    projectionVersion: text("projection_version").notNull(),
    authorityPolicyVersion: text("authority_policy_version").notNull(),
  },
  (table) => [
    uniqueIndex("mark_registration_number_unique")
      .on(table.registrationNumber)
      .where(sql`${table.registrationNumber} is not null`),
    index("mark_word_mark_normalized_exact_idx").on(table.wordMarkNormalized),
    index("mark_word_mark_normalized_trgm_idx")
      .using("gin", sql`${table.wordMarkNormalized} gin_trgm_ops`),
    index("mark_live_word_mark_normalized_exact_idx")
      .on(table.wordMarkNormalized)
      .where(sql`${table.searchStatus} = 'live'`),
    index("mark_live_word_mark_normalized_trgm_idx")
      .using("gin", sql`${table.wordMarkNormalized} gin_trgm_ops`)
      .where(sql`${table.searchStatus} = 'live'`),
  ],
);

export const markClass = pgTable(
  "mark_class",
  {
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    internationalCode: text("international_code"),
    statusCode: text("status_code"),
    statusDate: date("status_date"),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.ordinal] })],
);

export const markOwner = pgTable(
  "mark_owner",
  {
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    entryNumber: text("entry_number"),
    partyName: text("party_name"),
    partyType: text("party_type"),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.ordinal] })],
);

export const markGoodsServices = pgTable(
  "mark_goods_services",
  {
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    typeCode: text("type_code"),
    text: text("text"),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.ordinal] })],
);

export const markStatusEvent = pgTable(
  "mark_status_event",
  {
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    eventKey: varchar("event_key", { length: 64 }).notNull(),
    code: text("code"),
    type: text("type"),
    description: text("description"),
    eventDate: date("event_date"),
    eventNumber: text("event_number"),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.eventKey] })],
);

export const markGroupContributor = pgTable(
  "mark_group_contributor",
  {
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    group: text("group_name").notNull(),
    claimPath: text("claim_path").notNull(),
    product: text("product").notNull(),
    artifactVersionSha256: varchar("artifact_version_sha256", { length: 64 }).notNull(),
    physicalRecordIndex: integer("physical_record_index").notNull(),
  },
  (table) => [primaryKey({
    name: "mark_group_contributor_pk",
    columns: [
      table.serialNumber,
      table.group,
      table.claimPath,
      table.product,
      table.artifactVersionSha256,
      table.physicalRecordIndex,
    ],
  })],
);

export const publication = pgTable("publication", {
  id: uuid("id").primaryKey(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull().unique(),
  sourceFingerprint: varchar("source_fingerprint", { length: 64 }).notNull(),
  parentPublicationId: uuid("parent_publication_id"),
  parserVersion: text("parser_version").notNull(),
  authorityPolicyVersion: text("authority_policy_version").notNull(),
  projectionVersion: text("projection_version").notNull(),
  normalizationVersion: text("normalization_version").notNull(),
  sourceProfileVersion: text("source_profile_version").notNull(),
  state: publicationState("state").notNull().default("staged"),
  artifactCount: integer("artifact_count").notNull(),
  publishedThroughDate: date("published_through_date"),
  completeThroughDate: date("complete_through_date"),
  corpusVersion: bigint("corpus_version", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const publicationArtifact = pgTable(
  "publication_artifact",
  {
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publication.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").notNull().references(() => artifact.id),
    discoveryId: uuid("discovery_id").notNull().references(() => artifactDiscovery.id),
    artifactVersionId: uuid("artifact_version_id").notNull().references(() => artifactVersion.id),
    artifactVersionSha256: varchar("artifact_version_sha256", { length: 64 }).notNull(),
    parseRunId: uuid("parse_run_id").notNull().references(() => parseRun.id),
    parseRunDigest: varchar("parse_run_digest", { length: 64 }).notNull(),
    retainedVersionFingerprint: varchar("retained_version_fingerprint", { length: 64 }).notNull(),
    selectedExplicitly: boolean("selected_explicitly").notNull().default(false),
    sourceFromDate: date("source_from_date").notNull(),
    sourceToDate: date("source_to_date").notNull(),
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.artifactId] })],
);

export const publicationDiagnostic = pgTable(
  "publication_diagnostic",
  {
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publication.id, { onDelete: "cascade" }),
    diagnosticKey: varchar("diagnostic_key", { length: 64 }).notNull(),
    kind: publicationDiagnosticKind("kind").notNull(),
    serialNumber: text("serial_number").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.diagnosticKey] })],
);

export const corpusState = pgTable("corpus_state", {
  id: text("id").primaryKey(),
  publishedThroughDate: date("published_through_date"),
  completeThroughDate: date("complete_through_date"),
  lastSuccessfulMergeAt: timestamp("last_successful_merge_at", { withTimezone: true }),
  corpusVersion: bigint("corpus_version", { mode: "number" }).notNull().default(0),
  publicationId: uuid("publication_id").references(() => publication.id),
});

export const corpusEvent = pgTable(
  "corpus_event",
  {
    id: uuid("id").primaryKey(),
    publicationId: uuid("publication_id").notNull().references(() => publication.id),
    kind: text("kind").notNull(),
    corpusVersion: bigint("corpus_version", { mode: "number" }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("corpus_event_publication_kind_unique").on(table.publicationId, table.kind)],
);
