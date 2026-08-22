import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const defaultMigrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function migrateDatabase(
  databaseUrl: string,
  migrationsFolder = defaultMigrationsFolder
) {
  const client = postgres(databaseUrl, { max: 1 });

  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 1 });
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.TMTERMINAL_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("TMTERMINAL_DATABASE_URL is required");
  }

  await migrateDatabase(databaseUrl);
}
