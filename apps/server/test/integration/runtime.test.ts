import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
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

beforeEach(async () => {
  await resetTestDatabase(database);
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  );
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

describe("runtime database spine", () => {
  test("upgrades a database already migrated through landed migration 0001", async () => {
    const staged = await stageMigrationPrefix(2);
    await migrateDatabase(databaseUrl, staged);
    const [before] = await database<[{ artifactTable: boolean; migrations: number }]>`
      select
        to_regclass('public.artifact') is not null as "artifactTable",
        (select count(*)::int from drizzle.__drizzle_migrations) as migrations
    `;
    await migrateDatabase(databaseUrl);
    const [after] = await database<[{ artifactTable: boolean; migrations: number }]>`
      select
        to_regclass('public.artifact') is not null as "artifactTable",
        (select count(*)::int from drizzle.__drizzle_migrations) as migrations
    `;

    expect(before).toEqual({ artifactTable: false, migrations: 2 });
    expect(after).toEqual({ artifactTable: true, migrations: 12 });
  });

  test("upgrades populated pre-search data and preserves immutable generated search columns", async () => {
    const staged = await stageMigrationPrefix(9);
    await migrateDatabase(databaseUrl, staged);
    await database`
      insert into mark (
        serial_number,
        word_mark,
        status_code,
        normalization_version,
        source_profile_version,
        projection_version,
        authority_policy_version
      ) values ('99999999', ${"  Cafe\u0301  "}, '000', 'n', 's', 'p', 'a')
    `;
    await migrateDatabase(databaseUrl);
    await migrateDatabase(databaseUrl);

    const [row] = await database<Array<{ normalized: string; status: string }>>`
      select word_mark_normalized as normalized, search_status as status
      from mark where serial_number = '99999999'
    `;
    const columns = await database<Array<{ expression: string; name: string }>>`
      select column_name as name, generation_expression as expression
      from information_schema.columns
      where table_schema = 'public' and table_name = 'mark'
        and column_name in ('word_mark_normalized', 'search_status')
      order by column_name
    `;
    const indexes = await database<Array<{ name: string }>>`
      select indexname as name from pg_indexes
      where schemaname = 'public' and tablename = 'mark'
        and indexname like 'mark%word_mark_normalized%'
      order by indexname
    `;
    const normalizeFunctions = await database<Array<{ volatility: string }>>`
      select provolatile as volatility from pg_proc where proname = 'normalize'
    `;
    const [migrationCount] = await database<[{ count: number }]>`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;

    expect(row).toEqual({ normalized: "café", status: "unknown" });
    expect(columns).toHaveLength(2);
    expect(columns.find(({ name }) => name === "word_mark_normalized")?.expression).toContain(
      "NFKC"
    );
    expect(indexes.map(({ name }) => name)).toEqual([
      "mark_live_word_mark_normalized_exact_idx",
      "mark_live_word_mark_normalized_trgm_idx",
      "mark_word_mark_normalized_exact_idx",
      "mark_word_mark_normalized_trgm_idx",
    ]);
    expect(normalizeFunctions.length).toBeGreaterThan(0);
    expect(normalizeFunctions.every(({ volatility }) => volatility === "i")).toBe(true);
    expect(migrationCount?.count).toBe(12);
  }, 30_000);

  test("retires pre-v3 derived state before the first Class 025 worker starts", async () => {
    const staged = await stageMigrationPrefix(11);
    await migrateDatabase(databaseUrl, staged);

    await database`
      insert into dataset_product (id) values ('TRTYRAP'), ('TRTDXFAP')
    `;
    await database`
      insert into artifact (id, product_id, filename) values
        ('00000000-0000-4000-8000-000000000001', 'TRTYRAP', 'apc18840407-20251231-01.zip'),
        ('00000000-0000-4000-8000-000000000002', 'TRTYRAP', 'prd-60-tracer-annual-2025-full-tx-60146682.xml'),
        ('00000000-0000-4000-8000-000000000003', 'TRTDXFAP', 'quarantined.zip')
    `;
    await database`
      insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state) values
        ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', ${"1".repeat(64)}, 10, 'sha256/official', 'published'),
        ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', ${"2".repeat(64)}, 11, 'sha256/tracer', 'staged'),
        ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', ${"3".repeat(64)}, 12, 'sha256/quarantine', 'quarantined')
    `;
    await database`
      insert into artifact_discovery (
        id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state,
        download_url, expected_bytes, source_from_date, source_to_date, release_date,
        source_last_modified_at
      ) values (
        '20000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        ${"4".repeat(64)}, now(), 'verified', 'https://example.test/official.zip', 10,
        '1884-04-07', '2025-12-31', '2026-01-01', now()
      )
    `;
    await database`
      insert into parse_run (id, artifact_version_id, state, parser_version, digest) values
        ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'staged', 'uspto-application-xml-v2', ${"5".repeat(64)}),
        ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'staged', 'uspto-application-xml-v2', ${"6".repeat(64)}),
        ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'quarantined', 'uspto-application-xml-v2', ${"7".repeat(64)})
    `;
    await database`
      insert into source_record (
        id, parse_run_id, physical_record_index, action_key, action_occurrence,
        action_record_index, serial_number, schema_version, schema_version_date, profile,
        digest, values
      ) values
        ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, 'TX', 1, 1, '60146682', '2.0', '20041108', 'annual-tx-full-v1', ${"8".repeat(64)}, '[]'::jsonb),
        ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 1, 'TX', 1, 1, '60146682', '2.0', '20041108', 'annual-tx-full-v1', ${"9".repeat(64)}, '[]'::jsonb)
    `;
    await database`
      insert into source_claim (
        id, source_record_id, claim_order, path, occurrence, presence, operation, raw_value
      ) values
        ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 1, 'case-file/serial-number', 1, 'value', 'set', '60146682'),
        ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 1, 'case-file/serial-number', 1, 'value', 'set', '60146682')
    `;
    await database`
      insert into parse_reject (id, parse_run_id, reason, raw_xml, bytes, digest)
      values (
        '60000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000003',
        'durable quarantine', '\\x00', 1, ${"a".repeat(64)}
      )
    `;
    await database`
      insert into mark (
        serial_number, word_mark, normalization_version, source_profile_version,
        projection_version, authority_policy_version
      ) values ('60146682', 'MACHINE-PISTOL', 'v1', 'v1', 'v1', 'v1')
    `;

    await migrateDatabase(databaseUrl);
    await migrateDatabase(databaseUrl);

    const [result] = await database<
      Array<{
        canonicalMarks: number;
        migrationCount: number;
        obsoleteRuns: number;
        officialCatalog: number;
        officialState: string;
        quarantineEvidence: number;
        retainedObjects: string[];
        tracerArtifacts: number;
      }>
    >`
      select
        (select count(*)::int from mark) as "canonicalMarks",
        (select count(*)::int from drizzle.__drizzle_migrations) as "migrationCount",
        (select count(*)::int from parse_run where state <> 'quarantined' and parser_version <> 'uspto-application-xml-v3') as "obsoleteRuns",
        (select count(*)::int from artifact where filename = 'apc18840407-20251231-01.zip') as "officialCatalog",
        (select state::text from artifact_version where id = '10000000-0000-4000-8000-000000000001') as "officialState",
        (select count(*)::int from parse_reject where reason = 'durable quarantine') as "quarantineEvidence",
        (select array_agg(object_key order by object_key) from artifact_version) as "retainedObjects",
        (select count(*)::int from artifact where filename = 'prd-60-tracer-annual-2025-full-tx-60146682.xml') as "tracerArtifacts"
    `;

    expect(result).toEqual({
      canonicalMarks: 0,
      migrationCount: 12,
      obsoleteRuns: 0,
      officialCatalog: 1,
      officialState: "verified",
      quarantineEvidence: 1,
      retainedObjects: ["sha256/official", "sha256/quarantine"],
      tracerArtifacts: 0,
    });
  }, 30_000);

  test("refuses the Class 025 cutover after durable publication exists", async () => {
    await migrateDatabase(databaseUrl, await stageMigrationPrefix(11));
    await database`
      insert into publication (
        id, fingerprint, source_fingerprint, parser_version, authority_policy_version,
        projection_version, normalization_version, source_profile_version, state, artifact_count
      ) values (
        '70000000-0000-4000-8000-000000000001', ${"b".repeat(64)}, ${"c".repeat(64)},
        'uspto-application-xml-v2', 'v1', 'v1', 'v1', 'v1', 'published', 1
      )
    `;
    await database`
      insert into mark (
        serial_number, word_mark, normalization_version, source_profile_version,
        projection_version, authority_policy_version
      ) values ('60146682', 'MACHINE-PISTOL', 'v1', 'v1', 'v1', 'v1')
    `;

    await expect(migrateDatabase(databaseUrl)).rejects.toThrow(
      "Class 025 cutover requires no durable corpus or publication"
    );

    const [result] = await database<
      Array<{ canonicalMarks: number; migrationCount: number; publications: number }>
    >`
      select
        (select count(*)::int from mark) as "canonicalMarks",
        (select count(*)::int from drizzle.__drizzle_migrations) as "migrationCount",
        (select count(*)::int from publication) as publications
    `;
    expect(result).toEqual({ canonicalMarks: 1, migrationCount: 11, publications: 1 });
  }, 30_000);

  test("applies the one-shot migration idempotently", async () => {
    await migrateDatabase(databaseUrl);
    await migrateDatabase(databaseUrl);

    const [extension] = await database<[{ installed: boolean }]>`
      select exists (
        select 1 from pg_extension where extname = 'pg_trgm'
      ) as installed
    `;
    const [migrationCount] = await database<[{ count: number }]>`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;

    expect(extension?.installed).toBe(true);
    expect(migrationCount?.count).toBe(12);
  });

  test("reports ready after migrations complete", async () => {
    await migrateDatabase(databaseUrl);
    const server = await buildServer({ databaseUrl, logger: false });

    try {
      const response = await server.inject({ method: "GET", url: "/api/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ status: string }>()).toEqual({ status: "ready" });
    } finally {
      await server.close();
    }
  });
});
