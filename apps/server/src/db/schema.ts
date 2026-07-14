import { index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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
