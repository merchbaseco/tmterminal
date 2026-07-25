import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
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

test("creates the perpetual live schema idempotently", async () => {
  await migrateDatabase(databaseUrl);
  await migrateDatabase(databaseUrl);
  await database`
    insert into mark (
      serial_number, word_mark, status_code, normalization_version, source_product,
      source_filename, source_sha256, source_physical_record_index
    ) values (
      '99999999', ${"  Cafe\u0301  "}, '000', 'v1', 'TRTYRAP', 'annual.zip',
      ${"b".repeat(64)}, 1
    )
  `;
  const [mark] = await database<
    Array<{ normalized: string; status: string }>
  >`select word_mark_normalized normalized, search_status status from mark`;
  const tables = await database<Array<{ name: string }>>`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name
  `;
  expect(mark).toEqual({ normalized: "café", status: "unknown" });
  expect(tables.map(({ name }) => name)).toEqual(
    expect.arrayContaining(["mark", "source_artifact", "trademark_recency", "worker_status"])
  );
  expect(tables.map(({ name }) => name)).not.toContain("corpus_generation");
  expect(tables.map(({ name }) => name)).not.toContain("source_lane");
});

test("backfills expanded search preferences without replacing existing choices", async () => {
  await migrateDatabase(databaseUrl, await stageMigrationPrefix(27));
  const accountId = "00000000-0000-4000-8000-000000000001";
  const legacyPreferences = {
    defaultMatch: "exact",
    defaultSort: "newest-activity",
    defaultStatus: "live",
    pageSize: 50,
    resultDensity: "comfortable",
  };
  await database`
    insert into account (id, name, search_preferences)
    values (${accountId}, 'preferences-owner', ${database.json(legacyPreferences)})
  `;

  await migrateDatabase(databaseUrl);
  await migrateDatabase(databaseUrl);

  const [account] = await database<Array<{ searchPreferences: Record<string, unknown> }>>`
    select search_preferences as "searchPreferences"
    from account
    where id = ${accountId}
  `;
  expect(account?.searchPreferences).toEqual({
    defaultMatch: "exact",
    defaultRegistered: "all",
    defaultSort: "newest-activity",
    defaultStatus: "live",
    defaultType: "all",
    pageSize: 50,
    resultDensity: "comfortable",
  });
});

test("refuses the cutover while a legacy source can still be replayed", async () => {
  await migrateDatabase(databaseUrl, await stageMigrationPrefix(22));
  await database`
    insert into source_artifact (
      id, product, filename, download_url, expected_bytes, source_from_date, source_to_date,
      download_state, projection_state
    ) values (
      '41000000-0000-4000-8000-000000000001', 'TRTDXFAP', 'apc260704.zip',
      'https://example.test/apc260704.zip', 10, '2026-07-04', '2026-07-04',
      'complete', 'pending'
    )
  `;

  await expect(migrateDatabase(databaseUrl)).rejects.toThrow(
    "live-ingestion cutover requires every legacy source artifact to be complete"
  );
});

test("preserves auth and searchable data across the deployed live-ingestion cutover", async () => {
  await migrateDatabase(databaseUrl, await stageMigrationPrefix(22));
  const accountId = "00000000-0000-4000-8000-000000000001";
  const artifactId = "41000000-0000-4000-8000-000000000001";
  const sourceSha = "a".repeat(64);
  await database`insert into account (id, name) values (${accountId}, 'owner')`;
  await database`
    insert into clerk_identity (clerk_user_id, account_id) values ('user_1', ${accountId})
  `;
  await database`
    insert into api_key (id, account_id, name, secret_hash, suffix)
    values ('10000000-0000-4000-8000-000000000001', ${accountId}, 'cli',
      ${"a".repeat(64)}, '12345678')
  `;
  await database`insert into role_assignment (account_id, role) values (${accountId}, 'operator')`;
  await database`
    insert into source_artifact (
      id, product, filename, download_url, expected_bytes, source_from_date, source_to_date,
      download_state, projection_state, projection_version, sha256, physical_record_count,
      projected_mark_count, projection_completed_at
    ) values (
      ${artifactId}, 'TRTDXFAP', 'apc260704.zip', 'https://example.test/apc260704.zip', 10,
      '2026-07-04', '2026-07-04', 'complete', 'complete', 'uspto-projection-v2', ${sourceSha},
      100, 10, '2026-07-18T18:00:00Z'
    )
  `;
  await database`
    insert into mark (
      serial_number, word_mark, status_code, normalization_version, source_product,
      source_filename, source_sha256, source_physical_record_index, source_transaction_date
    ) values (
      '70000004', 'PRESERVED LIVE MARK', '616', 'uspto-normalization-v1', 'TRTDXFAP',
      'apc260704.zip', ${sourceSha}, 1, '2026-07-04'
    )
  `;

  await migrateDatabase(databaseUrl);
  await migrateDatabase(databaseUrl);

  expect([
    ...(await database`
      select (select count(*)::int from account) accounts,
        (select count(*)::int from clerk_identity) identities,
        (select count(*)::int from api_key) keys,
        (select count(*)::int from role_assignment) roles
    `),
  ]).toEqual([{ accounts: 1, identities: 1, keys: 1, roles: 1 }]);
  expect([
    ...(await database`
      select filename, download_state, application_state, applied_record_count, current_error,
        processing_disposition from source_artifact
    `),
  ]).toEqual([
    {
      application_state: "complete",
      applied_record_count: 100,
      current_error: null,
      download_state: "downloaded",
      filename: "apc260704.zip",
      processing_disposition: "required",
    },
  ]);
  expect([
    ...(await database`
      select mark.word_mark, mark.source_snapshot_hash, recency.source_transaction_date::text date
      from mark join trademark_recency recency using (serial_number)
      where mark.serial_number = '70000004'
    `),
  ]).toEqual([
    {
      date: "2026-07-04",
      source_snapshot_hash: "0".repeat(64),
      word_mark: "PRESERVED LIVE MARK",
    },
  ]);
  expect([...(await database`select id, activity from worker_status`)]).toEqual([
    { activity: "idle", id: "uspto" },
  ]);
});
