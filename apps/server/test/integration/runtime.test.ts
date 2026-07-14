import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 1 });

beforeAll(async () => {
  await database.unsafe("drop schema if exists drizzle cascade");
  await database.unsafe("drop extension if exists pg_trgm cascade");
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

describe("runtime database spine", () => {
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
    expect(migrationCount?.count).toBe(1);
  });

  test("reports ready after migrations complete", async () => {
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
