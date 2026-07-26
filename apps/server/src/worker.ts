import { createDatabaseClient } from "./db/client.ts";
import { createIngestionScheduler } from "./ingestion/ingestion-scheduler.ts";
import { createLocalArtifactStore } from "./ingestion/local-artifact-store.ts";
import { createOdpSourceCatalog } from "./ingestion/odp-source-catalog.ts";
import { createTrademarkIngestion } from "./ingestion/trademark-ingestion.ts";
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
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const database = createDatabaseClient(databaseUrl);
const healthFile = "/tmp/tmterminal-worker-ready";
const requestTimeoutMs = milliseconds("USPTO_REQUEST_TIMEOUT_MS", 15 * 60 * 1000);
const artifactStore = createLocalArtifactStore(
  process.env.ARTIFACT_STORE_ROOT ?? "/var/lib/tmterminal/artifacts",
  {
    stagingMaxAgeMs: requestTimeoutMs * 2,
  }
);
const ingestion = createTrademarkIngestion({
  artifactStore,
  database,
  extractXml: extractZipXml,
  sourceCatalog: createOdpSourceCatalog({
    apiKey: usptoApiKey,
    timeoutMs: requestTimeoutMs,
  }),
});
const scheduler = createIngestionScheduler({
  onError: (error) => console.error("Ingestion scheduler error", error),
  reconcile: () => ingestion.reconcile(),
});
const sync = createSyncService(database);
let stopping = false;
let heartbeatTimer: Timer | undefined;
let firstReconciliationComplete = false;

async function checkDatabase() {
  await database`select 1`;
}

async function refreshHealth() {
  await ingestion.pulse();
  await checkDatabase();
  const status = await sync.status();
  await Bun.write(
    healthFile,
    isWorkerReady(status.activeState, firstReconciliationComplete) ? String(Date.now()) : "0"
  );
}

async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  await scheduler.stop();
  await database.end({ timeout: 1 });
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stop().catch((error) => console.error("Worker shutdown failed", error));
  });
}

await Bun.write(healthFile, "0");
await checkDatabase();
await ingestion.initialize();
heartbeatTimer = setInterval(() => {
  refreshHealth().catch(async (error) => {
    console.error("Worker database readiness failed", error);
    await database.end({ timeout: 1 });
    process.exit(1);
  });
}, 10_000);
await scheduler.start();
const firstReconciliation = await scheduler.waitForFirstReconciliation();
if (firstReconciliation.ok) {
  firstReconciliationComplete = true;
  await refreshHealth();
}
