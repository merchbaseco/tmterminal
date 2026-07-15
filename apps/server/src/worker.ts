import { createDatabaseClient } from "./db/client.ts";
import { createArtifactScheduler } from "./ingestion/artifact-scheduler.ts";
import { createLocalArtifactStore } from "./ingestion/local-artifact-store.ts";
import { createOdpSourceCatalog } from "./ingestion/odp-source-catalog.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const usptoApiKey = process.env.USPTO_API_KEY;
if (!usptoApiKey) {
  throw new Error("USPTO_API_KEY is required");
}

function milliseconds(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const database = createDatabaseClient(databaseUrl);
const healthFile = "/tmp/tmturtle-worker-ready";
const pollMs = milliseconds("USPTO_SCHEDULER_POLL_MS", 10_000);
const requestTimeoutMs = milliseconds("USPTO_REQUEST_TIMEOUT_MS", 15 * 60 * 1_000);
const scheduler = createArtifactScheduler({
  artifactStore: createLocalArtifactStore(process.env.ARTIFACT_STORE_ROOT ?? "/var/lib/tmturtle/artifacts", {
    stagingMaxAgeMs: requestTimeoutMs * 2,
  }),
  database,
  discoveryIntervalMs: milliseconds("USPTO_DISCOVERY_INTERVAL_MS", 6 * 60 * 60 * 1_000),
  products: ["TRTDXFAP", "TRTYRAP"],
  retry: {
    baseMs: milliseconds("USPTO_RETRY_BASE_MS", 30_000),
    jitter: Math.random,
    maxAttempts: milliseconds("USPTO_RETRY_MAX_ATTEMPTS", 8),
    maxMs: milliseconds("USPTO_RETRY_MAX_MS", 6 * 60 * 60 * 1_000),
  },
  sourceCatalog: createOdpSourceCatalog({
    apiKey: usptoApiKey,
    timeoutMs: requestTimeoutMs,
  }),
});
let stopping = false;
let timer: Timer | undefined;
let heartbeatTimer: Timer | undefined;
let reportedStop = false;

async function checkDatabase() {
  await database`select 1`;
}

async function markReady() {
  await checkDatabase();
  await Bun.write(healthFile, String(Date.now()));
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await database.end({ timeout: 1 });
  process.exit(0);
}

async function run() {
  try {
    const result = await scheduler.runOnce();
    if (result.status === "stopped" && !reportedStop) {
      console.error("USPTO source lane stopped", result);
      reportedStop = true;
    }
  } catch (error) {
    console.error("Worker reconciliation failed", error);
    await database.end({ timeout: 1 });
    process.exit(1);
  }
  if (!stopping) timer = setTimeout(() => void run(), pollMs);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void stop());
}

await Bun.write(healthFile, "0");
await checkDatabase();
await run();
await markReady();
heartbeatTimer = setInterval(() => {
  void markReady().catch(async (error) => {
    console.error("Worker database readiness failed", error);
    await database.end({ timeout: 1 });
    process.exit(1);
  });
}, 10_000);
