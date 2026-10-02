import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import type { ArtifactStore } from "../../src/ingestion/artifact-store.ts";
import type { DiscoveredArtifact, DiscoveredProduct } from "../../src/ingestion/source-catalog.ts";
import {
  SourceContractError,
  SourceHttpError,
  SourceTransportError,
} from "../../src/ingestion/source-catalog.ts";
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

test("a transient 429 with retry-after respects backoff timing", async () => {
  const retryAfterSeconds = 60;
  const module = createTrademarkIngestion({
    artifactStore,
    database,
    extractXml: async (archivePath) => Readable.from([documents.get(archivePath) ?? ""]),
    now: () => now,
    sourceCatalog: {
      // biome-ignore lint/suspicious/useAwait: matches SourceCatalog interface
      discover: async (product) => {
        discoveryCalls += 1;
        if (discoveryCalls === 1) {
          throw new SourceHttpError(
            "USPTO ODP request failed with HTTP 429",
            { retryAfter: String(retryAfterSeconds), status: 429 },
            "catalog"
          );
        }
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

  // First reconcile triggers discovery, which throws 429
  const firstResult = await module.reconcile();
  expect(firstResult).not.toEqual({ action: "stopped" }); // Should not be stopped
  expect(discoveryCalls).toBe(1);

  // Worker should have backoff error (visible but not blocking)
  const [worker1] = await database<Array<{ currentError: string | null }>>`
    select current_error as "currentError" from worker_status where id = 'uspto'
  `;
  expect(worker1?.currentError).toContain("Discovery backoff:");

  // Advance time by 30 seconds (still within backoff)
  now = new Date(now.getTime() + 30 * 1000);
  const _duringBackoff = await module.reconcile();
  expect(discoveryCalls).toBe(1); // Discovery should not be retried during backoff

  // Advance time past the backoff (60 seconds from first failure)
  now = new Date(now.getTime() + 31 * 1000);
  const afterBackoff = await module.reconcile();
  expect(afterBackoff).toEqual({ action: "discovered", artifactCount: 3 });
  expect(discoveryCalls).toBe(3); // 1 failed + 2 successful (one per product)
});

test("a transient 429 without retry-after uses conservative backoff", async () => {
  let attemptTime: Date | null = null;
  const module = createTrademarkIngestion({
    artifactStore,
    database,
    extractXml: async (archivePath) => Readable.from([documents.get(archivePath) ?? ""]),
    now: () => now,
    sourceCatalog: {
      // biome-ignore lint/suspicious/useAwait: matches SourceCatalog interface
      discover: async (product) => {
        discoveryCalls += 1;
        attemptTime = new Date(now);
        if (discoveryCalls === 1) {
          throw new SourceHttpError(
            "USPTO ODP request failed with HTTP 429",
            { status: 429 }, // No retry-after header
            "catalog"
          );
        }
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

  // First reconcile triggers discovery, which throws 429 without retry-after
  await module.reconcile();
  expect(discoveryCalls).toBe(1);
  // biome-ignore lint/style/noNonNullAssertion: test setup guarantees non-null
  const firstAttempt = attemptTime!;

  // Advance time by 30 seconds (should still be in conservative backoff)
  now = new Date(now.getTime() + 30 * 1000);
  await module.reconcile();
  expect(discoveryCalls).toBe(1); // Should not retry yet

  // Advance time by another 35 seconds (65 total, past conservative backoff)
  now = new Date(now.getTime() + 35 * 1000);
  await module.reconcile();
  expect(discoveryCalls).toBeGreaterThan(1); // Should have retried

  // Verify backoff was at least 60 seconds
  // biome-ignore lint/style/noNonNullAssertion: test setup guarantees non-null
  const retryTime = attemptTime!;
  const backoffMs = retryTime.getTime() - firstAttempt.getTime();
  expect(backoffMs).toBeGreaterThanOrEqual(60 * 1000);
});

test("a non-retryable SourceContractError stops the worker", async () => {
  const module = createTrademarkIngestion({
    artifactStore,
    database,
    extractXml: async (archivePath) => Readable.from([documents.get(archivePath) ?? ""]),
    now: () => now,
    sourceCatalog: {
      // biome-ignore lint/suspicious/useAwait: matches SourceCatalog interface
      discover: async () => {
        discoveryCalls += 1;
        throw new SourceContractError("USPTO catalog returned invalid data");
      },
      download: async ({ filename }) => ({
        body: new Blob([filename]).stream(),
        expectedBytes: Buffer.byteLength(filename),
        responseState: { status: 200 },
      }),
    },
  });

  // First reconcile triggers discovery, which throws non-retryable error
  await expect(module.reconcile()).rejects.toThrow("USPTO catalog returned invalid data");
  expect(discoveryCalls).toBe(1);

  // Error should be persisted in worker_status
  const [worker] = await database<Array<{ currentError: string | null }>>`
    select current_error as "currentError" from worker_status where id = 'uspto'
  `;
  expect(worker?.currentError).toContain("USPTO catalog returned invalid data");

  // Second reconcile should return "stopped" without retrying
  expect(await module.reconcile()).toEqual({ action: "stopped" });
  expect(discoveryCalls).toBe(1); // Discovery was not retried

  // Third reconcile also returns "stopped"
  expect(await module.reconcile()).toEqual({ action: "stopped" });
  expect(discoveryCalls).toBe(1);
});

test("a non-retryable SourceTransportError stops the worker", async () => {
  const module = createTrademarkIngestion({
    artifactStore,
    database,
    extractXml: async (archivePath) => Readable.from([documents.get(archivePath) ?? ""]),
    now: () => now,
    sourceCatalog: {
      // biome-ignore lint/suspicious/useAwait: matches SourceCatalog interface
      discover: async () => {
        discoveryCalls += 1;
        throw new SourceTransportError("Network connection failed");
      },
      download: async ({ filename }) => ({
        body: new Blob([filename]).stream(),
        expectedBytes: Buffer.byteLength(filename),
        responseState: { status: 200 },
      }),
    },
  });

  // First reconcile triggers discovery, which throws transport error
  await expect(module.reconcile()).rejects.toThrow("Network connection failed");
  expect(discoveryCalls).toBe(1);

  // Error should be persisted
  const [worker] = await database<Array<{ currentError: string | null }>>`
    select current_error as "currentError" from worker_status where id = 'uspto'
  `;
  expect(worker?.currentError).toContain("Network connection failed");

  // Subsequent reconciles return "stopped"
  expect(await module.reconcile()).toEqual({ action: "stopped" });
  expect(discoveryCalls).toBe(1);
});

test("successful discovery after prior 429 clears any lingering error state", async () => {
  let shouldFail = true;
  const module = createTrademarkIngestion({
    artifactStore,
    database,
    extractXml: async (archivePath) => Readable.from([documents.get(archivePath) ?? ""]),
    now: () => now,
    sourceCatalog: {
      // biome-ignore lint/suspicious/useAwait: matches SourceCatalog interface
      discover: async (product) => {
        discoveryCalls += 1;
        if (shouldFail) {
          shouldFail = false;
          throw new SourceHttpError(
            "USPTO ODP request failed with HTTP 429",
            { retryAfter: "5", status: 429 },
            "catalog"
          );
        }
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

  // First reconcile: 429 with 5-second backoff
  await module.reconcile();
  expect(discoveryCalls).toBe(1);

  // Advance past backoff
  now = new Date(now.getTime() + 10 * 1000);

  // Second reconcile: succeeds
  const result = await module.reconcile();
  expect(result).toEqual({ action: "discovered", artifactCount: 3 });

  // Verify error was cleared
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
