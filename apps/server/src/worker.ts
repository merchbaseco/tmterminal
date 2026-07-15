import { createDatabaseClient } from "./db/client.ts";
import { createArtifactScheduler } from "./ingestion/artifact-scheduler.ts";
import { createIngestionReconciler } from "./ingestion/ingestion-reconciler.ts";
import { createIngestionScheduler } from "./ingestion/ingestion-scheduler.ts";
import { createLocalArtifactStore } from "./ingestion/local-artifact-store.ts";
import { createOdpSourceCatalog } from "./ingestion/odp-source-catalog.ts";
import { extractZipXml } from "./ingestion/zip-artifact-xml.ts";
import { createSyncService } from "./services/sync-service.ts";
import { isWorkerReady } from "./worker-readiness.ts";

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
const artifactStore = createLocalArtifactStore(process.env.ARTIFACT_STORE_ROOT ?? "/var/lib/tmturtle/artifacts", {
    stagingMaxAgeMs: requestTimeoutMs * 2,
});
const artifactScheduler = createArtifactScheduler({
  artifactStore,
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
const reconciler = createIngestionReconciler({
  artifactScheduler,
  artifactStore,
  database,
  extractXml: extractZipXml,
});
const scheduler = createIngestionScheduler({
  databaseUrl,
  onError: (error) => console.error("Ingestion scheduler error", error),
  pollMs,
  reconcile: () => reconciler.reconcile(),
});
const sync = createSyncService(database);
let stopping = false;
let heartbeatTimer: Timer | undefined;

async function checkDatabase() {
  await database`select 1`;
}

async function markReady() {
  await checkDatabase();
  const status = await sync.status();
  await Bun.write(healthFile, isWorkerReady(status.activeState) ? String(Date.now()) : "0");
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await scheduler.stop();
  await database.end({ timeout: 1 });
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void stop());
}

await Bun.write(healthFile, "0");
await checkDatabase();
await scheduler.start();
const firstReconciliation = await scheduler.waitForFirstReconciliation();
if (firstReconciliation.ok) await markReady();
heartbeatTimer = setInterval(() => {
  void markReady().catch(async (error) => {
    console.error("Worker database readiness failed", error);
    await database.end({ timeout: 1 });
    process.exit(1);
  });
}, 10_000);
