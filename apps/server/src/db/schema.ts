import {
  bigint,
  date,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("artifact_version_artifact_sha256_unique").on(table.artifactId, table.sha256)],
);

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
  },
  (table) => [uniqueIndex("source_alert_attempt_unique").on(table.attemptId)],
);
