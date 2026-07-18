import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  foreignKey,
  index,
  integer,
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

export const sourceLaneStatus = pgEnum("source_lane_status", ["ready", "backoff", "stopped"]);
export const sourceArtifactState = pgEnum("source_artifact_state", [
  "pending",
  "downloading",
  "projecting",
  "complete",
  "failed",
]);

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
  currentError: text("current_error"),
  failureCount: integer("failure_count").notNull().default(0),
  id: text("id").primaryKey(),
  nextEligibleAt: timestamp("next_eligible_at", { withTimezone: true }),
  status: sourceLaneStatus("status").notNull().default("ready"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sourceArtifact = pgTable(
  "source_artifact",
  {
    bytes: bigint("bytes", { mode: "number" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    currentError: text("current_error"),
    downloadUrl: text("download_url").notNull(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    filename: text("filename").notNull(),
    id: uuid("id").primaryKey(),
    objectKey: text("object_key"),
    physicalRecordCount: integer("physical_record_count").notNull().default(0),
    product: text("product").notNull(),
    projectedMarkCount: integer("projected_mark_count").notNull().default(0),
    sha256: varchar("sha256", { length: 64 }),
    sourceFromDate: date("source_from_date").notNull(),
    sourceToDate: date("source_to_date").notNull(),
    state: sourceArtifactState("state").notNull().default("pending"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_artifact_product_filename_unique").on(table.product, table.filename),
    index("source_artifact_state_filename_idx").on(table.state, table.filename),
  ]
);

export const mark = pgTable(
  "mark",
  {
    filingDate: date("filing_date"),
    markDrawingCode: text("mark_drawing_code"),
    normalizationVersion: text("normalization_version").notNull(),
    registrationDate: date("registration_date"),
    registrationNumber: text("registration_number"),
    searchStatus: text("search_status").generatedAlwaysAs(markSearchStatusSql),
    serialNumber: text("serial_number").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourcePhysicalRecordIndex: integer("source_physical_record_index").notNull(),
    sourceProduct: text("source_product").notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    sourceTransactionDate: date("source_transaction_date"),
    statusCode: text("status_code"),
    statusDate: date("status_date"),
    wordMark: text("word_mark").notNull(),
    wordMarkNormalized: text("word_mark_normalized").generatedAlwaysAs(
      sql`lower(normalize(btrim(word_mark), NFKC) collate "und-x-icu") collate "default"`
    ),
  },
  (table) => [
    primaryKey({ columns: [table.serialNumber] }),
    uniqueIndex("mark_registration_number_unique")
      .on(table.registrationNumber)
      .where(sql`${table.registrationNumber} is not null`),
    index("mark_word_mark_exact_idx").using("hash", table.wordMarkNormalized),
    index("mark_filing_date_idx").on(table.filingDate, table.serialNumber),
    index("mark_registration_date_idx").on(table.registrationDate, table.serialNumber),
    index("mark_status_activity_idx").on(
      table.statusCode,
      table.sourceTransactionDate,
      table.serialNumber
    ),
    index("mark_word_mark_normalized_trgm_idx").using(
      "gin",
      sql`${table.wordMarkNormalized} gin_trgm_ops`
    ),
    index("mark_live_word_mark_exact_idx")
      .using("hash", table.wordMarkNormalized)
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
    serialNumber: text("serial_number").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourcePhysicalRecordIndex: integer("source_physical_record_index").notNull(),
    sourceProduct: text("source_product").notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    statusCode: text("status_code"),
    statusDate: date("status_date"),
  },
  (table) => [
    primaryKey({ columns: [table.serialNumber, table.ordinal] }),
    foreignKey({
      columns: [table.serialNumber],
      foreignColumns: [mark.serialNumber],
    }).onDelete("cascade"),
  ]
);

export const markOwner = pgTable(
  "mark_owner",
  {
    entryNumber: text("entry_number"),
    ordinal: integer("ordinal").notNull(),
    partyName: text("party_name"),
    partyType: text("party_type"),
    serialNumber: text("serial_number").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourcePhysicalRecordIndex: integer("source_physical_record_index").notNull(),
    sourceProduct: text("source_product").notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serialNumber, table.ordinal] }),
    foreignKey({
      columns: [table.serialNumber],
      foreignColumns: [mark.serialNumber],
    }).onDelete("cascade"),
  ]
);

export const markGoodsServices = pgTable(
  "mark_goods_services",
  {
    ordinal: integer("ordinal").notNull(),
    serialNumber: text("serial_number").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourcePhysicalRecordIndex: integer("source_physical_record_index").notNull(),
    sourceProduct: text("source_product").notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    text: text("text"),
    typeCode: text("type_code"),
  },
  (table) => [
    primaryKey({ columns: [table.serialNumber, table.ordinal] }),
    foreignKey({
      columns: [table.serialNumber],
      foreignColumns: [mark.serialNumber],
    }).onDelete("cascade"),
  ]
);

export const markStatusEvent = pgTable(
  "mark_status_event",
  {
    code: text("code"),
    description: text("description"),
    eventDate: date("event_date"),
    eventKey: varchar("event_key", { length: 64 }).notNull(),
    eventNumber: text("event_number"),
    serialNumber: text("serial_number").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourcePhysicalRecordIndex: integer("source_physical_record_index").notNull(),
    sourceProduct: text("source_product").notNull(),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    type: text("type"),
  },
  (table) => [
    primaryKey({ columns: [table.serialNumber, table.eventKey] }),
    foreignKey({
      columns: [table.serialNumber],
      foreignColumns: [mark.serialNumber],
    }).onDelete("cascade"),
  ]
);

export const dataState = pgTable("data_state", {
  completeThroughDate: date("complete_through_date"),
  id: text("id").primaryKey(),
  lastSuccessfulUpdateAt: timestamp("last_successful_update_at", { withTimezone: true }),
  version: bigint("version", { mode: "number" }).notNull().default(0),
});
