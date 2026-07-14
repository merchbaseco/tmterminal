import { createDatabaseClient } from "./db/client.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const database = createDatabaseClient(databaseUrl);
const healthFile = "/tmp/tmturtle-worker-ready";
let stopping = false;

async function checkDatabase() {
  await database`select 1`;
  await Bun.write(healthFile, String(Date.now()));
}

async function stop() {
  if (stopping) return;
  stopping = true;
  await database.end({ timeout: 1 });
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void stop());
}

await Bun.write(healthFile, "0");
await checkDatabase();

setInterval(async () => {
  try {
    await checkDatabase();
  } catch (error) {
    console.error("Worker database readiness failed", error);
    await database.end({ timeout: 1 });
    process.exit(1);
  }
}, 10_000);
