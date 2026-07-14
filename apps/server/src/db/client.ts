import postgres from "postgres";

export function createDatabaseClient(databaseUrl: string) {
  return postgres(databaseUrl, { connect_timeout: 1 });
}
