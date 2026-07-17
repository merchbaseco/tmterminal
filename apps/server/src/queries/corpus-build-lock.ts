import type postgres from "postgres";

type Database = postgres.Sql | postgres.TransactionSql;

export async function lockCorpusBuild(database: Database) {
  await database`select pg_advisory_xact_lock(hashtext('tmturtle-corpus-build'))`;
}
