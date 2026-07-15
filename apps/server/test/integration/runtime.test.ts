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
    expect(after).toEqual({ artifactTable: true, migrations: 9 });
  });

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
    expect(migrationCount?.count).toBe(9);
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
