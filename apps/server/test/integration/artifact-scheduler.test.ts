import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { createArtifactScheduler } from "../../src/ingestion/artifact-scheduler.ts";
import type { ArtifactStore } from "../../src/ingestion/artifact-store.ts";
import { createIngestionReconciler } from "../../src/ingestion/ingestion-reconciler.ts";
import { createLocalArtifactStore } from "../../src/ingestion/local-artifact-store.ts";
import {
  type DiscoveredProduct,
  type SourceCatalog,
  SourceHttpError,
} from "../../src/ingestion/source-catalog.ts";
import { readArtifactInventory, resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 4, prepare: false });
const artifactRoots: string[] = [];

async function* artifactObjectKeys(keys: string[] = []) {
  await Promise.resolve();
  yield* keys;
}

const discovery: DiscoveredProduct = {
  artifacts: [
    {
      bytes: 5,
      downloadUrl: "https://api.uspto.gov/files/apc240925.zip",
      filename: "apc240925.zip",
      fromDate: "2024-09-25",
      lastModifiedAt: "2024-09-26T11:30:00Z",
      releaseDate: "2024-09-26",
      toDate: "2024-09-25",
    },
  ],
  product: {
    frequency: "Daily",
    identifier: "TRTDXFAP",
    lastModifiedAt: "2024-09-26T12:00:00Z",
    title: "Trademark Daily XML Files",
  },
  responseState: { status: 200 },
};

const unusedStore: ArtifactStore = {
  get: async () => new Blob([]).stream(),
  head: async () => null,
  listObjectKeys: artifactObjectKeys,
  put: () => Promise.reject(new Error("download not expected")),
  remove: () => Promise.resolve(),
};

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterEach(async () => {
  await Promise.all(
    artifactRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

test("repeated discovery is a persisted no-op", async () => {
  const catalog: SourceCatalog = {
    discover: () => Promise.resolve(discovery),
    download: () => Promise.reject(new Error("download not expected")),
  };
  const scheduler = createArtifactScheduler({
    artifactStore: unusedStore,
    database,
    discoveryIntervalMs: 0,
    products: ["TRTDXFAP"],
    sourceCatalog: catalog,
  });

  expect(await scheduler.runOnce()).toMatchObject({ action: "discover", changed: true });
  expect(await scheduler.runOnce()).toMatchObject({ action: "discover", changed: false });
  expect(await readArtifactInventory(database)).toMatchObject({
    artifacts: [{ downloadState: "pending", filename: "apc240925.zip" }],
    attempts: [{ outcome: "success" }, { outcome: "success" }],
    discoveryCount: 1,
    productCount: 1,
    versions: [],
  });
});

test("unchanged bytes are a no-op and changed bytes create immutable versions", async () => {
  const currentDiscovery = structuredClone(discovery);
  const [currentArtifact] = currentDiscovery.artifacts;
  if (!currentArtifact) {
    throw new Error("Expected one discovery artifact fixture");
  }
  let downloadBytes = "alpha";
  let clock = new Date("2026-07-14T12:00:00Z");
  const catalog: SourceCatalog = {
    discover: async () => currentDiscovery,
    download: async () => ({
      body: new Blob([downloadBytes]).stream(),
      expectedBytes: 5,
      responseState: { contentLength: "5", status: 200 },
    }),
  };
  const root = await mkdtemp(join(tmpdir(), "tmturtle-scheduler-"));
  artifactRoots.push(root);
  const scheduler = createArtifactScheduler({
    artifactStore: createLocalArtifactStore(root),
    database,
    discoveryIntervalMs: 60_000,
    now: () => clock,
    products: ["TRTDXFAP"],
    sourceCatalog: catalog,
  });

  await scheduler.runOnce();
  expect(await scheduler.runOnce()).toMatchObject({ action: "download", versionCreated: true });

  clock = new Date(clock.getTime() + 60_001);
  currentArtifact.lastModifiedAt = "2024-09-26T11:31:00Z";
  await scheduler.runOnce();
  expect(await scheduler.runOnce()).toMatchObject({ action: "download", versionCreated: false });

  clock = new Date(clock.getTime() + 60_001);
  currentArtifact.lastModifiedAt = "2024-09-26T11:32:00Z";
  downloadBytes = "bravo";
  await scheduler.runOnce();
  expect(await scheduler.runOnce()).toMatchObject({ action: "download", versionCreated: true });

  expect(await readArtifactInventory(database)).toMatchObject({
    artifacts: [{ downloadState: "verified", filename: "apc240925.zip" }],
    discoveries: [
      {
        downloadState: "verified",
        versionSha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
      },
      {
        downloadState: "verified",
        versionSha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
      },
      {
        downloadState: "verified",
        versionSha256: "f144a6907dc4284d1f9fe6a7d9b9ff53c02c1d07ba68f24d413d7ff7f757a782",
      },
    ],
    discoveryCount: 3,
    versions: [
      {
        filename: "apc240925.zip",
        sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
      },
      {
        filename: "apc240925.zip",
        sha256: "f144a6907dc4284d1f9fe6a7d9b9ff53c02c1d07ba68f24d413d7ff7f757a782",
      },
    ],
  });
});

test("restart removes a finalized orphan before retaining changed retry bytes", async () => {
  let clock = new Date("2026-07-14T12:00:00Z");
  let downloadBytes = "alpha";
  const catalog: SourceCatalog = {
    discover: () => Promise.resolve(discovery),
    download: () =>
      Promise.resolve({
        body: new Blob([downloadBytes]).stream(),
        expectedBytes: 5,
        responseState: { contentLength: "5", status: 200 },
      }),
  };
  const root = await mkdtemp(join(tmpdir(), "tmturtle-scheduler-crash-"));
  artifactRoots.push(root);
  const localStore = createLocalArtifactStore(root);
  const crashingStore: ArtifactStore = {
    ...localStore,
    put: async (body, expectedBytes) => {
      await localStore.put(body, expectedBytes);
      throw new Error("crash after finalized put");
    },
  };
  const crashed = createArtifactScheduler({
    artifactStore: crashingStore,
    database,
    discoveryIntervalMs: 60_000,
    now: () => clock,
    products: ["TRTDXFAP"],
    sourceCatalog: catalog,
  });

  expect(await crashed.runOnce()).toMatchObject({ action: "discover" });
  await expect(crashed.runOnce()).rejects.toThrow("crash after finalized put");
  const orphan = "sha256/8e/8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8";
  expect(await Array.fromAsync(localStore.listObjectKeys())).toEqual([orphan]);

  downloadBytes = "bravo";
  const restartedScheduler = createArtifactScheduler({
    artifactStore: localStore,
    database,
    discoveryIntervalMs: 60_000,
    now: () => clock,
    products: ["TRTDXFAP"],
    retry: { baseMs: 1000, jitter: () => 0, maxAttempts: 3, maxMs: 1000 },
    sourceCatalog: catalog,
  });
  const restarted = createIngestionReconciler({
    artifactScheduler: restartedScheduler,
    artifactStore: localStore,
    database,
    extractXml: (archive) => archive,
  });
  expect(await restarted.reconcile()).toEqual({ action: "orphan-cleanup", removed: 1 });
  const interrupted = await restarted.reconcile();
  expect(interrupted).toMatchObject({ action: "source", source: { status: "backoff" } });
  const nextEligibleAt = interrupted.action === "source" && interrupted.source.nextEligibleAt;
  if (!(nextEligibleAt instanceof Date)) {
    throw new Error("Expected interrupted source backoff");
  }
  clock = new Date(nextEligibleAt.getTime() + 1);
  expect(await restarted.reconcile()).toMatchObject({
    action: "source",
    source: { action: "download", versionCreated: true },
  });

  const retryKey = "sha256/f1/f144a6907dc4284d1f9fe6a7d9b9ff53c02c1d07ba68f24d413d7ff7f757a782";
  expect(await localStore.head(orphan)).toBeNull();
  expect(await Array.fromAsync(localStore.listObjectKeys())).toEqual([retryKey]);
  expect(await readArtifactInventory(database)).toMatchObject({
    discoveries: [{ downloadState: "verified", versionSha256: retryKey.slice(-64) }],
    versions: [{ sha256: retryKey.slice(-64) }],
  });
});

test("queues every changed discovery and links each retained version", async () => {
  const currentDiscovery = structuredClone(discovery);
  const [currentArtifact] = currentDiscovery.artifacts;
  if (!currentArtifact) {
    throw new Error("Expected one discovery artifact fixture");
  }
  let clock = new Date("2026-07-14T12:00:00Z");
  const catalog: SourceCatalog = {
    discover: async () => currentDiscovery,
    download: (url) => {
      const bytes = url.endsWith("reissued.zip") ? "bravo" : "alpha";
      return Promise.resolve({
        body: new Blob([bytes]).stream(),
        expectedBytes: 5,
        responseState: { contentLength: "5", status: 200 },
      });
    },
  };
  const root = await mkdtemp(join(tmpdir(), "tmturtle-scheduler-"));
  artifactRoots.push(root);
  const scheduler = createArtifactScheduler({
    artifactStore: createLocalArtifactStore(root),
    database,
    discoveryIntervalMs: 60_000,
    now: () => clock,
    products: ["TRTDXFAP"],
    sourceCatalog: catalog,
  });

  await scheduler.runOnce();
  clock = new Date(clock.getTime() + 60_001);
  currentArtifact.downloadUrl = "https://api.uspto.gov/files/reissued.zip";
  currentArtifact.lastModifiedAt = "2024-09-26T11:31:00Z";
  await scheduler.runOnce();
  expect(await scheduler.runOnce()).toMatchObject({ action: "download", versionCreated: true });
  expect(await scheduler.runOnce()).toMatchObject({ action: "download", versionCreated: true });

  expect(await readArtifactInventory(database)).toMatchObject({
    discoveries: [
      {
        downloadState: "verified",
        downloadUrl: "https://api.uspto.gov/files/apc240925.zip",
        versionSha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
      },
      {
        downloadState: "verified",
        downloadUrl: "https://api.uspto.gov/files/reissued.zip",
        versionSha256: "f144a6907dc4284d1f9fe6a7d9b9ff53c02c1d07ba68f24d413d7ff7f757a782",
      },
    ],
    discoveryCount: 2,
    versions: [
      { sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8" },
      { sha256: "f144a6907dc4284d1f9fe6a7d9b9ff53c02c1d07ba68f24d413d7ff7f757a782" },
    ],
  });
});

test("rejects a response length that conflicts with discovered metadata", async () => {
  let stored = false;
  const catalog: SourceCatalog = {
    discover: async () => discovery,
    download: async () => ({
      body: new Blob(["four"]).stream(),
      expectedBytes: 4,
      responseState: { contentLength: "4", status: 200 },
    }),
  };
  const scheduler = createArtifactScheduler({
    artifactStore: {
      ...unusedStore,
      put: () => {
        stored = true;
        return Promise.reject(new Error("store should not receive conflicting bytes"));
      },
    },
    database,
    discoveryIntervalMs: 60_000,
    products: ["TRTDXFAP"],
    sourceCatalog: catalog,
  });

  await scheduler.runOnce();
  expect(await scheduler.runOnce()).toMatchObject({ status: "backoff" });
  expect(stored).toBe(false);
  expect(await readArtifactInventory(database)).toMatchObject({
    artifacts: [{ downloadState: "pending" }],
    attempts: [{ outcome: "success" }, { errorCode: "INTEGRITY", outcome: "transient_failure" }],
    versions: [],
  });
});

test("restart preserves provider retry eligibility and transient count", async () => {
  let clock = new Date("2026-07-14T12:00:00Z");
  let requests = 0;
  const catalog: SourceCatalog = {
    discover: () => {
      requests += 1;
      if (requests === 1) {
        return Promise.reject(
          new SourceHttpError("throttled", {
            rateLimitReset: String((clock.getTime() + 180_000) / 1000),
            retryAfter: "120",
            status: 429,
          })
        );
      }
      return Promise.resolve(discovery);
    },
    download: () => Promise.reject(new Error("download not expected")),
  };
  const options = {
    artifactStore: unusedStore,
    database,
    discoveryIntervalMs: 60_000,
    now: () => clock,
    products: ["TRTDXFAP"],
    retry: { baseMs: 1000, jitter: () => 0, maxMs: 60_000 },
    sourceCatalog: catalog,
  };

  expect(await createArtifactScheduler(options).runOnce()).toEqual({
    nextEligibleAt: new Date("2026-07-14T12:03:00Z"),
    status: "backoff",
  });
  clock = new Date("2026-07-14T12:02:59Z");
  expect(await createArtifactScheduler(options).runOnce()).toEqual({
    nextEligibleAt: new Date("2026-07-14T12:03:00Z"),
    status: "backoff",
  });
  expect(requests).toBe(1);

  clock = new Date("2026-07-14T12:03:01Z");
  expect(await createArtifactScheduler(options).runOnce()).toMatchObject({
    action: "discover",
    changed: true,
  });
  expect(requests).toBe(2);
  expect(await readArtifactInventory(database)).toMatchObject({
    attempts: [
      {
        errorCode: "HTTP_429",
        outcome: "transient_failure",
        retryEligibleAt: new Date("2026-07-14T12:03:00Z"),
      },
      { errorCode: null, outcome: "success", retryEligibleAt: null },
    ],
    lane: { status: "ready", transientFailureCount: 0 },
  });
});

test("restart recovers an interrupted attempt into persisted backoff before another request", async () => {
  let clock = new Date("2026-07-14T12:00:00Z");
  let requests = 0;
  await database`insert into source_lane (id) values ('uspto-odp')`;
  await database`insert into dataset_product (id) values ('TRTDXFAP')`;
  await database`
    insert into source_attempt (id, lane_id, kind, product_id, started_at)
    values ('00000000-0000-4000-8000-000000000001', 'uspto-odp', 'discovery', 'TRTDXFAP', ${clock})
  `;
  const options = {
    artifactStore: unusedStore,
    database,
    discoveryIntervalMs: 60_000,
    now: () => clock,
    products: ["TRTDXFAP"],
    retry: { baseMs: 1000, jitter: () => 0, maxMs: 60_000 },
    sourceCatalog: {
      discover: () => {
        requests += 1;
        return Promise.resolve(discovery);
      },
      download: () => Promise.reject(new Error("download not expected")),
    } satisfies SourceCatalog,
  };

  expect(await createArtifactScheduler(options).runOnce()).toEqual({
    nextEligibleAt: new Date("2026-07-14T12:00:01Z"),
    status: "backoff",
  });
  expect(requests).toBe(0);
  expect(await readArtifactInventory(database)).toMatchObject({
    attempts: [
      {
        errorCode: "INTERRUPTED",
        outcome: "transient_failure",
        retryEligibleAt: new Date("2026-07-14T12:00:01Z"),
      },
    ],
    lane: { status: "backoff", transientFailureCount: 1 },
  });

  clock = new Date("2026-07-14T12:00:02Z");
  expect(await createArtifactScheduler(options).runOnce()).toMatchObject({
    action: "discover",
    changed: true,
  });
  expect(requests).toBe(1);
});

test("credential failure stops and alerts the persisted lane", async () => {
  let requests = 0;
  const catalog: SourceCatalog = {
    discover: () => {
      requests += 1;
      return Promise.reject(
        new SourceHttpError("forbidden", { requestId: "safe-request-id", status: 403 })
      );
    },
    download: () => Promise.reject(new Error("download not expected")),
  };
  const options = {
    artifactStore: unusedStore,
    database,
    discoveryIntervalMs: 60_000,
    products: ["TRTDXFAP"],
    sourceCatalog: catalog,
  };

  expect(await createArtifactScheduler(options).runOnce()).toEqual({
    reason: "HTTP_403",
    status: "stopped",
  });
  expect(await createArtifactScheduler(options).runOnce()).toEqual({ status: "stopped" });
  expect(requests).toBe(1);
  expect(await readArtifactInventory(database)).toMatchObject({
    alerts: [{ kind: "credential", message: "USPTO credential rejected" }],
    attempts: [
      {
        errorCode: "HTTP_403",
        outcome: "credential_failure",
        responseState: { requestId: "safe-request-id", status: 403 },
        retryEligibleAt: null,
      },
    ],
    lane: { status: "stopped", transientFailureCount: 0 },
    versions: [],
  });
});

test("one credential lane serializes source calls", async () => {
  let releaseDiscovery!: () => void;
  let reportStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    reportStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  const catalog: SourceCatalog = {
    discover: async () => {
      reportStarted();
      await release;
      return discovery;
    },
    download: () => Promise.reject(new Error("download not expected")),
  };
  const options = {
    artifactStore: unusedStore,
    database,
    discoveryIntervalMs: 60_000,
    products: ["TRTDXFAP"],
    sourceCatalog: catalog,
  };

  const first = createArtifactScheduler(options).runOnce();
  await started;
  expect(await createArtifactScheduler(options).runOnce()).toEqual({ status: "busy" });
  releaseDiscovery();
  expect(await first).toMatchObject({ action: "discover", changed: true });
});
