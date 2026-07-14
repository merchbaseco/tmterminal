import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const defaultMigrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function migrateDatabase(databaseUrl: string, migrationsFolder = defaultMigrationsFolder) {
  const client = postgres(databaseUrl, { max: 1 });

  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 1 });
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  await migrateDatabase(databaseUrl);
}
