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

function productionArtifact(part: number, generationId: string) {
  const filename = `apc18840407-20251231-${String(part).padStart(2, "0")}.zip`;
  let sha256: string | null = null;
  let state = "pending";
  if (part <= 25) {
    sha256 = "a".repeat(64);
    state = "complete";
  }
  if (part === 26) {
    sha256 = "15f42e5355652e3c70a2b3e4bc8d39f411c6e90c050ae5c89ace1d2b92266738";
    state = "projecting";
  }
  return {
    download_url: `https://example.test/${filename}`,
    expected_bytes: 1,
    filename,
    generation_id: generationId,
    id: `31000000-0000-4000-8000-${String(part).padStart(12, "0")}`,
    object_key: part === 26 ? "sha256/15/part26" : null,
    product: "TRTYRAP",
    sha256,
    source_from_date: "1884-04-07",
    source_to_date: "2025-12-31",
    state,
  };
}

describe("live trademark data migration", () => {
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
    expect(shape).toEqual({ legacyArtifact: false, migrations: 17, tables: 12 });
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

  test("creates the live search schema idempotently", async () => {
    await migrateDatabase(databaseUrl);
    await migrateDatabase(databaseUrl);
    await database`insert into mark (serial_number, word_mark, status_code, normalization_version, source_product, source_filename, source_sha256, source_physical_record_index) values ('99999999', ${"  Cafe\u0301  "}, '000', 'v1', 'TRTYRAP', 'annual.zip', ${"b".repeat(64)}, 1)`;
    const [mark] = await database<
      Array<{ normalized: string; status: string }>
    >`select word_mark_normalized normalized, search_status status from mark`;
    const indexes = await database<Array<{ method: string; name: string }>>`
      select index_class.relname as name, access_method.amname as method
      from pg_index index
      join pg_class index_class on index_class.oid = index.indexrelid
      join pg_class table_class on table_class.oid = index.indrelid
      join pg_am access_method on access_method.oid = index_class.relam
      where table_class.relname = 'mark'
      order by index_class.relname
    `;
    expect(mark).toEqual({ normalized: "café", status: "unknown" });
    expect([...indexes]).toEqual(
      expect.arrayContaining([
        { method: "hash", name: "mark_live_word_mark_exact_idx" },
        { method: "hash", name: "mark_word_mark_exact_idx" },
      ])
    );
  }, 30_000);

  test("moves the exact stopped Parts 01-26 shape into live tables without losing rows or ZIP state", async () => {
    await migrateDatabase(databaseUrl, await stageMigrationPrefix(15));
    const generationId = "30000000-0000-4000-8000-000000000001";
    await database`
      insert into corpus_generation (id, product, from_date, to_date, expected_artifact_count)
      values (${generationId}, 'TRTYRAP', '1884-04-07', '2025-12-31', 91)
    `;
    await database`insert into source_artifact ${database(
      Array.from({ length: 91 }, (_, index) => productionArtifact(index + 1, generationId))
    )}`;
    await database`
      insert into mark (generation_id, serial_number, word_mark, status_code, normalization_version,
        source_product, source_filename, source_sha256, source_physical_record_index)
      values (${generationId}, '70000001', 'PRESERVED MARK', '616', 'uspto-normalization-v1',
        'TRTYRAP', 'apc18840407-20251231-01.zip', ${"a".repeat(64)}, 1)
    `;
    await database`
      insert into mark_class (generation_id, serial_number, ordinal, international_code,
        source_product, source_filename, source_sha256, source_physical_record_index)
      values (${generationId}, '70000001', 1, '025', 'TRTYRAP',
        'apc18840407-20251231-01.zip', ${"a".repeat(64)}, 1)
    `;
    await database`
      insert into mark_owner (generation_id, serial_number, ordinal, entry_number, party_name,
        source_product, source_filename, source_sha256, source_physical_record_index)
      values (${generationId}, '70000001', 1, '1', 'PRESERVED OWNER', 'TRTYRAP',
        'apc18840407-20251231-01.zip', ${"a".repeat(64)}, 1)
    `;
    await database`
      insert into mark_goods_services (generation_id, serial_number, ordinal, type_code, text,
        source_product, source_filename, source_sha256, source_physical_record_index)
      values (${generationId}, '70000001', 1, 'GS0251', 'PRESERVED GOODS', 'TRTYRAP',
        'apc18840407-20251231-01.zip', ${"a".repeat(64)}, 1)
    `;
    await database`
      insert into mark_status_event (generation_id, serial_number, event_key, code, event_number,
        source_product, source_filename, source_sha256, source_physical_record_index)
      values (${generationId}, '70000001', ${"b".repeat(64)}, 'PRESERVED', '1', 'TRTYRAP',
        'apc18840407-20251231-01.zip', ${"a".repeat(64)}, 1)
    `;

    await migrateDatabase(databaseUrl);
    await migrateDatabase(databaseUrl);

    const [shape] = await database<
      Array<{
        complete: number;
        dataVersion: number;
        generationColumn: boolean;
        pending: number;
        projecting: number;
        retainedObject: string | null;
      }>
    >`
      select
        count(*) filter (where state = 'complete')::int complete,
        count(*) filter (where state = 'pending')::int pending,
        count(*) filter (where state = 'projecting')::int projecting,
        max(object_key) filter (where filename = 'apc18840407-20251231-26.zip') as "retainedObject",
        (select version::int from data_state where id = 'uspto') as "dataVersion",
        exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'source_artifact' and column_name = 'generation_id') as "generationColumn"
      from source_artifact
    `;
    expect(shape).toEqual({
      complete: 25,
      dataVersion: 1,
      generationColumn: false,
      pending: 65,
      projecting: 1,
      retainedObject: "sha256/15/part26",
    });
    expect(
      await database`select serial_number from mark where serial_number = '70000001'`
    ).toHaveLength(1);
    expect(
      await database`select serial_number from mark_class where serial_number = '70000001'`
    ).toHaveLength(1);
    expect(
      await database`select serial_number from mark_owner where serial_number = '70000001'`
    ).toHaveLength(1);
    expect(
      await database`select serial_number from mark_goods_services where serial_number = '70000001'`
    ).toHaveLength(1);
    expect(
      await database`select serial_number from mark_status_event where serial_number = '70000001'`
    ).toHaveLength(1);
    expect([...(await database`select to_regclass('public.corpus_generation') as table`)]).toEqual([
      { table: null },
    ]);
  }, 30_000);
});
