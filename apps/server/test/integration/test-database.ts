import type postgres from "postgres";

export async function resetTestDatabase(database: postgres.Sql) {
  await database.unsafe("drop schema if exists drizzle cascade");
  await database.unsafe("drop schema if exists public cascade");
  await database.unsafe("create schema public");
}
