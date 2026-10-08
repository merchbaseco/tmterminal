import { afterAll, beforeAll, expect, test } from "bun:test";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { fakeTmterminalAccess } from "../fake-access.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TMTERMINAL_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TMTERMINAL_TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 2, prepare: false });
let server: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  server = await buildServer({
    access: fakeTmterminalAccess(),
    databaseUrl,
    devClerkSignIn: null,
    logger: false,
  });
});

afterAll(async () => {
  await server?.close();
  await database.end({ timeout: 1 });
});

test("a migrated database with no heartbeat or successful update fails worker and uspto_data", async () => {
  const response = await server.inject({ method: "GET", url: "/api/health" });

  expect(response.statusCode).toBe(503);
  expect(response.body).toBe('{"status":"degraded","failing":["worker","uspto_data"]}');
});

test("a fresh heartbeat and successful update are ok", async () => {
  await database`
    update worker_status
    set last_heartbeat_at = clock_timestamp(), current_error = null
    where id = 'uspto'
  `;
  await database`
    update data_state
    set last_successful_update_at = clock_timestamp()
    where id = 'uspto'
  `;

  const response = await server.inject({ method: "GET", url: "/api/health" });

  expect(response.statusCode).toBe(200);
  expect(response.body).toBe('{"status":"ok"}');
});

test("a heartbeat 6 minutes in the past fails worker", async () => {
  await database`
    update worker_status
    set last_heartbeat_at = clock_timestamp() - interval '6 minutes'
    where id = 'uspto'
  `;

  const response = await server.inject({ method: "GET", url: "/api/health" });

  expect(response.statusCode).toBe(503);
  expect(response.body).toBe('{"status":"degraded","failing":["worker"]}');
});
