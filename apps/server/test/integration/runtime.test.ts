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

beforeEach(async () => {
  await resetTestDatabase(database);
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

describe("runtime database spine", () => {
  test("upgrades a database already migrated through landed migration 0001", async () => {
    const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
    const staged = await mkdtemp(join(tmpdir(), "tmturtle-migrations-"));
    temporaryDirectories.push(staged);
    await mkdir(join(staged, "meta"));
    await Promise.all([
      copyFile(join(source, "0000_enable-pg-trgm.sql"), join(staged, "0000_enable-pg-trgm.sql")),
      copyFile(join(source, "0001_chunky_marrow.sql"), join(staged, "0001_chunky_marrow.sql")),
    ]);
    const journal = await Bun.file(join(source, "meta", "_journal.json")).json();
    journal.entries = journal.entries.slice(0, 2);
    await Bun.write(join(staged, "meta", "_journal.json"), JSON.stringify(journal));

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
    expect(after).toEqual({ artifactTable: true, migrations: 11 });
  });

  test("upgrades populated pre-search data and preserves immutable generated search columns", async () => {
    const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
    const staged = await mkdtemp(join(tmpdir(), "tmturtle-migrations-"));
    temporaryDirectories.push(staged);
    await mkdir(join(staged, "meta"));
    const journal = await Bun.file(join(source, "meta", "_journal.json")).json();
    journal.entries = journal.entries.slice(0, 9);
    await Promise.all(journal.entries.map((entry: { tag: string }) =>
      copyFile(join(source, `${entry.tag}.sql`), join(staged, `${entry.tag}.sql`))
    ));
    await Bun.write(join(staged, "meta", "_journal.json"), JSON.stringify(journal));

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
    expect(columns.find(({ name }) => name === "word_mark_normalized")?.expression).toContain("NFKC");
    expect(indexes.map(({ name }) => name)).toEqual([
      "mark_live_word_mark_normalized_exact_idx",
      "mark_live_word_mark_normalized_trgm_idx",
      "mark_word_mark_normalized_exact_idx",
      "mark_word_mark_normalized_trgm_idx",
    ]);
    expect(normalizeFunctions.length).toBeGreaterThan(0);
    expect(normalizeFunctions.every(({ volatility }) => volatility === "i")).toBe(true);
    expect(migrationCount?.count).toBe(11);
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
    expect(migrationCount?.count).toBe(11);
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
