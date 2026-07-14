import { createDatabaseClient } from "./db/client.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const database = createDatabaseClient(databaseUrl);
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await database.end({ timeout: 1 });
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void stop());
}

await database`select 1`;

setInterval(async () => {
  try {
    await database`select 1`;
  } catch (error) {
    console.error("Worker database readiness failed", error);
    await database.end({ timeout: 1 });
    process.exit(1);
  }
}, 10_000);
