import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}
const database = postgres(databaseUrl, { max: 1, prepare: false });
const temporaryDirectories: string[] = [];

async function stageMigrationPrefix(entryCount: number) {
  const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
  const staged = await mkdtemp(join(tmpdir(), "tmturtle-migrations-"));
  temporaryDirectories.push(staged);
  await mkdir(join(staged, "meta"));
  const journal = await Bun.file(join(source, "meta", "_journal.json")).json();
  journal.entries = journal.entries.slice(0, entryCount);
  await Promise.all(
    journal.entries.map((entry: { tag: string }) =>
      copyFile(join(source, `${entry.tag}.sql`), join(staged, `${entry.tag}.sql`))
    )
  );
  await Bun.write(join(staged, "meta", "_journal.json"), JSON.stringify(journal));
  return staged;
}

beforeEach(() => resetTestDatabase(database));
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  );
});
afterAll(() => database.end({ timeout: 1 }));

describe("direct annual corpus migration", () => {
  test("preserves auth and role rows while discarding rebuildable legacy ingestion state", async () => {
    await migrateDatabase(databaseUrl, await stageMigrationPrefix(13));
    const accountId = "00000000-0000-4000-8000-000000000001";
    await database`insert into account (id, name) values (${accountId}, 'owner')`;
    await database`insert into clerk_identity (clerk_user_id, account_id) values ('user_1', ${accountId})`;
    await database`insert into api_key (id, account_id, name, secret_hash, suffix) values ('10000000-0000-4000-8000-000000000001', ${accountId}, 'cli', ${"a".repeat(64)}, '12345678')`;
    await database`insert into role_assignment (account_id, role) values (${accountId}, 'operator')`;
    await database`
      insert into source_lane (id, status, transient_failure_count, stop_reason, next_eligible_at)
      values
        ('uspto-backoff', 'backoff', 3, 'temporary provider failure', '2026-07-18T12:00:00Z'),
        ('uspto-stopped', 'stopped', 7, 'provider contract changed', null)
    `;
    await database`insert into dataset_product (id) values ('TRTYRAP')`;
    await database`insert into artifact (id, product_id, filename) values ('20000000-0000-4000-8000-000000000001', 'TRTYRAP', 'legacy.zip')`;

    await migrateDatabase(databaseUrl);
    await migrateDatabase(databaseUrl);

    const [auth] = await database<
      Array<{ accounts: number; identities: number; keys: number; roles: number }>
    >`
      select (select count(*)::int from account) accounts, (select count(*)::int from clerk_identity) identities,
        (select count(*)::int from api_key) keys, (select count(*)::int from role_assignment) roles`;
    const [shape] = await database<
      Array<{ legacyArtifact: boolean; migrations: number; tables: number }>
    >`
      select to_regclass('public.artifact') is not null as "legacyArtifact",
        (select count(*)::int from drizzle.__drizzle_migrations) migrations,
        (select count(*)::int from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') tables`;
    const lanes = await database<
      Array<{
        currentError: string | null;
        failureCount: number;
        id: string;
        nextEligibleAt: Date | null;
        status: string;
      }>
    >`
      select id, status, failure_count::int as "failureCount", current_error as "currentError",
        next_eligible_at as "nextEligibleAt"
      from source_lane order by id
    `;
    expect(auth).toEqual({ accounts: 1, identities: 1, keys: 1, roles: 1 });
    expect(shape).toEqual({ legacyArtifact: false, migrations: 15, tables: 14 });
    expect([...lanes]).toEqual([
      {
        currentError: "temporary provider failure",
        failureCount: 3,
        id: "uspto-backoff",
        nextEligibleAt: new Date("2026-07-18T12:00:00Z"),
        status: "backoff",
      },
      {
        currentError: "provider contract changed",
        failureCount: 7,
        id: "uspto-stopped",
        nextEligibleAt: null,
        status: "stopped",
      },
    ]);
  }, 30_000);

  test("creates the generation-scoped search schema idempotently", async () => {
    await migrateDatabase(databaseUrl);
    await migrateDatabase(databaseUrl);
    await database`insert into corpus_generation (id, product, from_date, to_date, expected_artifact_count) values ('30000000-0000-4000-8000-000000000001', 'TRTYRAP', '1884-04-07', '2025-12-31', 91)`;
    await database`insert into mark (generation_id, serial_number, word_mark, status_code, normalization_version, source_product, source_filename, source_sha256, source_physical_record_index) values ('30000000-0000-4000-8000-000000000001', '99999999', ${"  Cafe\u0301  "}, '000', 'v1', 'TRTYRAP', 'annual.zip', ${"b".repeat(64)}, 1)`;
    const [mark] = await database<
      Array<{ normalized: string; status: string }>
    >`select word_mark_normalized normalized, search_status status from mark`;
    const indexes = await database<
      Array<{ name: string }>
    >`select indexname name from pg_indexes where schemaname = 'public' and tablename = 'mark' order by indexname`;
    expect(mark).toEqual({ normalized: "café", status: "unknown" });
    expect(indexes.map(({ name }) => name)).toContain("mark_generation_word_mark_exact_idx");
  }, 30_000);
});
