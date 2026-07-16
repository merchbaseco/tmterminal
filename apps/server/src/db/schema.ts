import { sql } from "drizzle-orm";
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
import { markSearchStatusSql } from "../search/status-policy.ts";

export const artifactDownloadState = pgEnum("artifact_download_state", [
  "pending",
  "downloading",
  "verified",
]);
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
export const sourceClaimOperation = pgEnum("source_claim_operation", [
  "set",
  "clear",
  "replace",
  "assert",
]);
export const publicationState = pgEnum("publication_state", ["staged", "rejected", "published"]);
export const publicationDiagnosticKind = pgEnum("publication_diagnostic_kind", [
  "authority-conflict",
  "unsupported-semantics",
]);
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const account = pgTable("account", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  id: uuid("id").primaryKey(),
  name: varchar("name", { length: 80 }).unique(),
});

export const clerkIdentity = pgTable(
  "clerk_identity",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    clerkUserId: text("clerk_user_id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("clerk_identity_account_id_unique").on(table.accountId)]
);

export const apiKey = pgTable(
  "api_key",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    id: uuid("id").primaryKey(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    name: varchar("name", { length: 80 }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    secretHash: varchar("secret_hash", { length: 64 }).notNull(),
    suffix: varchar("suffix", { length: 8 }).notNull(),
  },
  (table) => [index("api_key_account_id_idx").on(table.accountId)]
);

export const roleAssignment = pgTable(
  "role_assignment",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    role: text("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.role] })]
);

export const sourceLane = pgTable("source_lane", {
  id: text("id").primaryKey(),
  lastResponseState: jsonb("last_response_state").$type<Record<string, unknown>>(),
  nextEligibleAt: timestamp("next_eligible_at", { withTimezone: true }),
  status: sourceLaneStatus("status").notNull().default("ready"),
  stopReason: text("stop_reason"),
  transientFailureCount: integer("transient_failure_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetProduct = pgTable("dataset_product", {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  frequency: text("frequency"),
  id: text("id").primaryKey(),
  metadataLastModifiedAt: timestamp("metadata_last_modified_at", { withTimezone: true }),
  nextDiscoveryAt: timestamp("next_discovery_at", { withTimezone: true }),
  title: text("title"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artifact = pgTable(
  "artifact",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    filename: text("filename").notNull(),
    id: uuid("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => datasetProduct.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("artifact_product_filename_unique").on(table.productId, table.filename)]
);

export const artifactVersion = pgTable(
  "artifact_version",
  {
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    id: uuid("id").primaryKey(),
    objectKey: text("object_key"),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
    quarantineReason: text("quarantine_reason"),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    state: artifactVersionState("state").notNull().default("verified"),
  },
  (table) => [
    uniqueIndex("artifact_version_artifact_sha256_unique").on(table.artifactId, table.sha256),
  ]
);

export const artifactVersionSelection = pgTable(
  "artifact_version_selection",
  {
    artifactId: uuid("artifact_id")
      .primaryKey()
      .references(() => artifact.id),
    artifactVersionId: uuid("artifact_version_id").notNull(),
    reason: text("reason").notNull(),
    retainedVersionCount: integer("retained_version_count").notNull(),
    retainedVersionFingerprint: varchar("retained_version_fingerprint", { length: 64 }).notNull(),
    selectedAt: timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.artifactVersionId],
      foreignColumns: [artifactVersion.id],
      name: "artifact_version_selection_version_fk",
    }),
  ]
);

// biome-ignore lint/style/useConsistentTypeDefinitions: Recursive JSON values must remain structurally assignable to JSONValue.
export type SourceValue = {
  name: string;
  presence: "empty" | "group" | "value";
  rawValue?: string;
  children?: SourceValue[];
};

export const parseRun = pgTable(
  "parse_run",
  {
    artifactVersionId: uuid("artifact_version_id")
      .notNull()
      .references(() => artifactVersion.id),
    digest: varchar("digest", { length: 64 }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    id: uuid("id").primaryKey(),
    parserVersion: text("parser_version").notNull(),
    recordCount: integer("record_count").notNull().default(0),
    rejectCount: integer("reject_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    state: parseRunState("state").notNull().default("parsing"),
  },
  (table) => [
    uniqueIndex("parse_run_artifact_parser_unique").on(
      table.artifactVersionId,
      table.parserVersion
    ),
  ]
);

export const sourceRecord = pgTable(
  "source_record",
  {
    actionKey: text("action_key").notNull(),
    actionOccurrence: integer("action_occurrence").notNull(),
    actionRecordIndex: integer("action_record_index").notNull(),
    digest: varchar("digest", { length: 64 }).notNull(),
    id: uuid("id").primaryKey(),
    parseRunId: uuid("parse_run_id")
      .notNull()
      .references(() => parseRun.id),
    physicalRecordIndex: integer("physical_record_index").notNull(),
    profile: text("profile").notNull(),
    schemaVersion: text("schema_version").notNull(),
    schemaVersionDate: text("schema_version_date").notNull(),
    serialNumber: text("serial_number").notNull(),
    sourceTransactionDate: date("source_transaction_date"),
    sourceTransactionDateRaw: text("source_transaction_date_raw"),
    values: jsonb("values").$type<SourceValue[]>().notNull(),
  },
  (table) => [
    uniqueIndex("source_record_run_position_unique").on(
      table.parseRunId,
      table.physicalRecordIndex
    ),
    uniqueIndex("source_record_action_position_unique").on(
      table.parseRunId,
      table.actionKey,
      table.actionOccurrence,
      table.actionRecordIndex
    ),
    index("source_record_serial_idx").on(table.serialNumber),
  ]
);

export const sourceClaim = pgTable(
  "source_claim",
  {
    claimOrder: integer("claim_order").notNull(),
    id: uuid("id").primaryKey(),
    occurrence: integer("occurrence").notNull(),
    operation: sourceClaimOperation("operation"),
    path: text("path").notNull(),
    presence: text("presence").notNull(),
    rawValue: text("raw_value"),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecord.id),
  },
  (table) => [
    uniqueIndex("source_claim_record_order_unique").on(table.sourceRecordId, table.claimOrder),
  ]
);

export const parseReject = pgTable("parse_reject", {
  bytes: integer("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  digest: varchar("digest", { length: 64 }).notNull(),
  id: uuid("id").primaryKey(),
  parseRunId: uuid("parse_run_id")
    .notNull()
    .references(() => parseRun.id),
  physicalRecordIndex: integer("physical_record_index"),
  rawXml: bytea("raw_xml").notNull(),
  reason: text("reason").notNull(),
});

export const artifactDiscovery = pgTable(
  "artifact_discovery",
  {
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id),
    artifactVersionId: uuid("artifact_version_id").references(() => artifactVersion.id),
    downloadState: artifactDownloadState("download_state").notNull().default("pending"),
    downloadUrl: text("download_url").notNull(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    id: uuid("id").primaryKey(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    releaseDate: date("release_date").notNull(),
    sourceFromDate: date("source_from_date").notNull(),
    sourceLastModifiedAt: timestamp("source_last_modified_at", { withTimezone: true }).notNull(),
    sourceToDate: date("source_to_date").notNull(),
  },
  (table) => [
    uniqueIndex("artifact_discovery_artifact_fingerprint_unique").on(
      table.artifactId,
      table.fingerprint
    ),
  ]
);

export const sourceAttempt = pgTable(
  "source_attempt",
  {
    discoveryId: uuid("discovery_id").references(() => artifactDiscovery.id),
    errorCode: text("error_code"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    id: uuid("id").primaryKey(),
    kind: sourceAttemptKind("kind").notNull(),
    laneId: text("lane_id")
      .notNull()
      .references(() => sourceLane.id),
    outcome: sourceAttemptOutcome("outcome").notNull().default("running"),
    productId: text("product_id").references(() => datasetProduct.id),
    responseState: jsonb("response_state").$type<Record<string, unknown>>(),
    retryEligibleAt: timestamp("retry_eligible_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("source_attempt_lane_started_idx").on(table.laneId, table.startedAt)]
);

export const sourceAlert = pgTable(
  "source_alert",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => sourceAttempt.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    id: uuid("id").primaryKey(),
    kind: sourceAlertKind("kind").notNull(),
    laneId: text("lane_id")
      .notNull()
      .references(() => sourceLane.id),
    message: text("message").notNull(),
    resolutionReason: text("resolution_reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("source_alert_attempt_unique").on(table.attemptId)]
);

export const mark = pgTable(
  "mark",
  {
    authorityPolicyVersion: text("authority_policy_version").notNull(),
    filingDate: date("filing_date"),
    markDrawingCode: text("mark_drawing_code"),
    normalizationVersion: text("normalization_version").notNull(),
    projectionVersion: text("projection_version").notNull(),
    registrationDate: date("registration_date"),
    registrationNumber: text("registration_number"),
    searchStatus: text("search_status").generatedAlwaysAs(markSearchStatusSql),
    serialNumber: text("serial_number").primaryKey(),
    sourceProfileVersion: text("source_profile_version").notNull(),
    sourceTransactionDate: date("source_transaction_date"),
    statusCode: text("status_code"),
    statusDate: date("status_date"),
    wordMark: text("word_mark"),
    wordMarkNormalized: text("word_mark_normalized").generatedAlwaysAs(
      sql`lower(normalize(btrim(word_mark), NFKC) collate "und-x-icu") collate "default"`
    ),
  },
  (table) => [
    uniqueIndex("mark_registration_number_unique")
      .on(table.registrationNumber)
      .where(sql`${table.registrationNumber} is not null`),
    index("mark_word_mark_normalized_exact_idx").on(table.wordMarkNormalized),
    index("mark_word_mark_normalized_trgm_idx").using(
      "gin",
      sql`${table.wordMarkNormalized} gin_trgm_ops`
    ),
    index("mark_live_word_mark_normalized_exact_idx")
      .on(table.wordMarkNormalized)
      .where(sql`${table.searchStatus} = 'live'`),
    index("mark_live_word_mark_normalized_trgm_idx")
      .using("gin", sql`${table.wordMarkNormalized} gin_trgm_ops`)
      .where(sql`${table.searchStatus} = 'live'`),
  ]
);

export const markClass = pgTable(
  "mark_class",
  {
    internationalCode: text("international_code"),
    ordinal: integer("ordinal").notNull(),
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    statusCode: text("status_code"),
    statusDate: date("status_date"),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.ordinal] })]
);

export const markOwner = pgTable(
  "mark_owner",
  {
    entryNumber: text("entry_number"),
    ordinal: integer("ordinal").notNull(),
    partyName: text("party_name"),
    partyType: text("party_type"),
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.ordinal] })]
);

export const markGoodsServices = pgTable(
  "mark_goods_services",
  {
    ordinal: integer("ordinal").notNull(),
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    text: text("text"),
    typeCode: text("type_code"),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.ordinal] })]
);

export const markStatusEvent = pgTable(
  "mark_status_event",
  {
    code: text("code"),
    description: text("description"),
    eventDate: date("event_date"),
    eventKey: varchar("event_key", { length: 64 }).notNull(),
    eventNumber: text("event_number"),
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
    type: text("type"),
  },
  (table) => [primaryKey({ columns: [table.serialNumber, table.eventKey] })]
);

export const markGroupContributor = pgTable(
  "mark_group_contributor",
  {
    artifactVersionSha256: varchar("artifact_version_sha256", { length: 64 }).notNull(),
    claimPath: text("claim_path").notNull(),
    group: text("group_name").notNull(),
    physicalRecordIndex: integer("physical_record_index").notNull(),
    product: text("product").notNull(),
    serialNumber: text("serial_number")
      .notNull()
      .references(() => mark.serialNumber, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [
        table.serialNumber,
        table.group,
        table.claimPath,
        table.product,
        table.artifactVersionSha256,
        table.physicalRecordIndex,
      ],
      name: "mark_group_contributor_pk",
    }),
  ]
);

export const publication = pgTable("publication", {
  artifactCount: integer("artifact_count").notNull(),
  authorityPolicyVersion: text("authority_policy_version").notNull(),
  completeThroughDate: date("complete_through_date"),
  corpusVersion: bigint("corpus_version", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull().unique(),
  id: uuid("id").primaryKey(),
  normalizationVersion: text("normalization_version").notNull(),
  parentPublicationId: uuid("parent_publication_id"),
  parserVersion: text("parser_version").notNull(),
  projectionVersion: text("projection_version").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedThroughDate: date("published_through_date"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  sourceFingerprint: varchar("source_fingerprint", { length: 64 }).notNull(),
  sourceProfileVersion: text("source_profile_version").notNull(),
  state: publicationState("state").notNull().default("staged"),
});

export const publicationArtifact = pgTable(
  "publication_artifact",
  {
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id),
    artifactVersionId: uuid("artifact_version_id")
      .notNull()
      .references(() => artifactVersion.id),
    artifactVersionSha256: varchar("artifact_version_sha256", { length: 64 }).notNull(),
    discoveryId: uuid("discovery_id")
      .notNull()
      .references(() => artifactDiscovery.id),
    parseRunDigest: varchar("parse_run_digest", { length: 64 }).notNull(),
    parseRunId: uuid("parse_run_id")
      .notNull()
      .references(() => parseRun.id),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publication.id, { onDelete: "cascade" }),
    retainedVersionFingerprint: varchar("retained_version_fingerprint", { length: 64 }).notNull(),
    selectedExplicitly: boolean("selected_explicitly").notNull().default(false),
    sourceFromDate: date("source_from_date").notNull(),
    sourceToDate: date("source_to_date").notNull(),
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.artifactId] })]
);

export const publicationDiagnostic = pgTable(
  "publication_diagnostic",
  {
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    diagnosticKey: varchar("diagnostic_key", { length: 64 }).notNull(),
    kind: publicationDiagnosticKind("kind").notNull(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publication.id, { onDelete: "cascade" }),
    serialNumber: text("serial_number").notNull(),
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.diagnosticKey] })]
);

export const corpusState = pgTable("corpus_state", {
  completeThroughDate: date("complete_through_date"),
  corpusVersion: bigint("corpus_version", { mode: "number" }).notNull().default(0),
  id: text("id").primaryKey(),
  lastSuccessfulMergeAt: timestamp("last_successful_merge_at", { withTimezone: true }),
  publicationId: uuid("publication_id").references(() => publication.id),
  publishedThroughDate: date("published_through_date"),
});

export const corpusEvent = pgTable(
  "corpus_event",
  {
    corpusVersion: bigint("corpus_version", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publication.id),
  },
  (table) => [
    uniqueIndex("corpus_event_publication_kind_unique").on(table.publicationId, table.kind),
  ]
);
