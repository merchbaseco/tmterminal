import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import type { ArtifactStore } from "../../src/ingestion/artifact-store.ts";
import type { DiscoveredArtifact, DiscoveredProduct } from "../../src/ingestion/source-catalog.ts";
import { SourceHttpError } from "../../src/ingestion/source-catalog.ts";
import { createTrademarkIngestion } from "../../src/ingestion/trademark-ingestion.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TMTERMINAL_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}
const database = postgres(databaseUrl, { max: 3, prepare: false });
const _sha = "a".repeat(64);
const annualFilename = "apc18840407-20251231-01.zip";
const dailyFilename = "apc260101.zip";
const retained = new Set<string>();
const documents = new Map<string, string>();
const reserved = new Map<string, { bytes: number; objectKey: string; sha256: string }>();
let now = new Date("2026-01-03T12:00:00Z");
let discoveryCalls = 0;

const artifactStore: ArtifactStore = {
  async *listObjectKeys() {
    yield* retained;
  },
  openFile: async (objectKey) => objectKey,
  put: async (body, expectedBytes, reservationKey) => {
    const bytes = Buffer.from(await new Response(body).arrayBuffer());
    if (expectedBytes !== null && bytes.length !== expectedBytes) {
      throw new Error("test download length mismatch");
    }
    const filename = bytes.toString("utf8");
    const objectKey = `source/${reservationKey}`;
    retained.add(objectKey);
    documents.set(objectKey, sourceDocument(recordFor(filename)));
    const stored = {
      bytes: bytes.length,
      objectKey,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    reserved.set(reservationKey, stored);
    return stored;
  },
  recoverPut: (reservationKey, expectedBytes) => {
    const stored = reserved.get(reservationKey);
    return Promise.resolve(stored?.bytes === expectedBytes ? stored : null);
  },
  remove: (objectKey) => {
    retained.delete(objectKey);
    documents.delete(objectKey);
    for (const [reservationKey, stored] of reserved) {
      if (stored.objectKey === objectKey) {
        reserved.delete(reservationKey);
      }
    }
    return Promise.resolve();
  },
};

beforeEach(async () => {
  retained.clear();
  reserved.clear();
  documents.clear();
  now = new Date("2026-01-03T12:00:00Z");
  discoveryCalls = 0;
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterAll(() => database.end({ timeout: 1 }));

test("a transient catalog 429 does not persist error and respects backoff timing", async () => {
  const module = createTrademarkIngestion({
    artifactStore,
    database,
    extractXml: async (archivePath) => Readable.from([documents.get(archivePath) ?? ""]),
    now: () => now,
    sourceCatalog: {
      // biome-ignore lint/suspicious/useAwait: matches SourceCatalog interface
      discover: async () => {
        discoveryCalls += 1;
        throw new SourceHttpError(
          "USPTO ODP request failed with HTTP 429",
          { retryAfter: "60", status: 429 },
          "catalog"
        );
      },
      download: async ({ filename }) => ({
        body: new Blob([filename]).stream(),
        expectedBytes: Buffer.byteLength(filename),
        responseState: { status: 200 },
      }),
    },
  });

  // First reconcile triggers discovery, which encounters 429
  expect(await module.reconcile()).toEqual({ action: "idle" });
  expect(discoveryCalls).toBe(1);

  // Error is stored with "Discovery backoff:" prefix (visible but not blocking)
  const [worker] = await database<
    Array<{ currentError: string | null; lastDiscoveryAt: Date | null }>
  >`
    select current_error as "currentError", last_discovery_at as "lastDiscoveryAt" from worker_status where id = 'uspto'
  `;
  expect(worker?.currentError).toContain("Discovery backoff:");

  // last_discovery_at is adjusted so that lastDiscoveryAt + 24h = backoff expiry
  // This allows the existing timing check to enforce backoff without schema changes
  const expectedDiscoveryAt = new Date("2026-01-03T12:01:00Z").getTime() - 24 * 60 * 60 * 1000;
  expect(worker?.lastDiscoveryAt?.getTime()).toBe(expectedDiscoveryAt);

  // Second reconcile respects backoff, does not retry discovery yet
  expect(await module.reconcile()).toEqual({ action: "idle" });
  expect(discoveryCalls).toBe(1); // Discovery was NOT retried (still in backoff window)

  // Advance time past backoff window
  now = new Date("2026-01-03T12:01:01Z");

  // Third reconcile should retry discovery (but will fail again)
  expect(await module.reconcile()).toEqual({ action: "idle" });
  expect(discoveryCalls).toBe(2); // Discovery WAS retried after backoff expired
});

test("a transient catalog 429 followed by success should recover", async () => {
  let attemptCount = 0;
  const module = createTrademarkIngestion({
    artifactStore,
    database,
    extractXml: async (archivePath) => Readable.from([documents.get(archivePath) ?? ""]),
    now: () => now,
    sourceCatalog: {
      // biome-ignore lint/suspicious/useAwait: matches SourceCatalog interface
      discover: async (product) => {
        discoveryCalls += 1;
        attemptCount += 1;
        if (attemptCount === 1) {
          throw new SourceHttpError(
            "USPTO ODP request failed with HTTP 429",
            { retryAfter: "60", status: 429 },
            "catalog"
          );
        }
        // Second attempt succeeds
        return product === "TRTYRAP"
          ? discovered("TRTYRAP", "YEARLY", [artifact(annualFilename, "1884-04-07", "2025-12-31")])
          : discovered("TRTDXFAP", "DAILY", [
              artifact("apc251231.zip", "2025-12-31", "2025-12-31"),
              artifact(dailyFilename, "2026-01-01", "2026-01-01"),
            ]);
      },
      download: async ({ filename }) => ({
        body: new Blob([filename]).stream(),
        expectedBytes: Buffer.byteLength(filename),
        responseState: { status: 200 },
      }),
    },
  });

  // First reconcile triggers discovery, which encounters 429
  expect(await module.reconcile()).toEqual({ action: "idle" });
  expect(discoveryCalls).toBe(1);

  // Advance time past backoff window
  now = new Date("2026-01-03T12:01:01Z");

  // Second reconcile should retry discovery and succeed
  const result = await module.reconcile();

  expect(result).toEqual({ action: "discovered", artifactCount: 3 });
  expect(discoveryCalls).toBe(3); // 1 failed + 2 successful (one per product)

  // Worker error should be cleared
  const [worker] = await database<Array<{ currentError: string | null }>>`
    select current_error as "currentError" from worker_status where id = 'uspto'
  `;
  expect(worker?.currentError).toBeNull();
});

function sourceDocument(record: string) {
  return `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><application-information><file-segments><file-segment>1</file-segment><action-keys><action-key>TX</action-key>${record}</action-keys></file-segments></application-information></trademark-applications-daily>`;
}

function recordFor(filename: string) {
  const daily = filename === dailyFilename;
  return `<case-file><serial-number>74668071</serial-number><registration-number>1974886</registration-number><transaction-date>${
    daily ? "20260101" : "20251231"
  }</transaction-date><case-file-header><filing-date>19950501</filing-date><registration-date>19960521</registration-date><status-code>800</status-code><status-date>20160607</status-date><mark-identification>${
    daily ? "DAILY SHIRT" : "ANNUAL SHIRT"
  }</mark-identification><mark-drawing-code>1</mark-drawing-code></case-file-header><classifications><international-code>025</international-code><status-code>6</status-code><status-date>19950706</status-date><primary-code>025</primary-code></classifications><case-file-statements><case-file-statement><type-code>GS0251</type-code><text>shirts</text></case-file-statement></case-file-statements></case-file>`;
}

function artifact(filename: string, fromDate: string, toDate: string): DiscoveredArtifact {
  return {
    bytes: Buffer.byteLength(filename),
    downloadUrl: `https://api.uspto.gov/api/v1/datasets/products/files/${
      filename === annualFilename ? "TRTYRAP" : "TRTDXFAP"
    }/${filename}`,
    filename,
    fromDate,
    lastModifiedAt: "2026-01-03T00:00:00Z",
    releaseDate: "2026-01-03",
    toDate,
  };
}

function discovered(
  product: "TRTDXFAP" | "TRTYRAP",
  frequency: "DAILY" | "YEARLY",
  artifacts: DiscoveredArtifact[]
): DiscoveredProduct {
  return {
    artifacts,
    product: {
      frequency,
      identifier: product,
      lastModifiedAt: "2026-01-03T00:00:00Z",
      title: product,
    },
    responseState: { status: 200 },
  };
}
