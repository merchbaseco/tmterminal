import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { annualBaselineV1Artifacts } from "../../src/ingestion/annual-baseline-v1.ts";
import { SourceHttpError, SourceTransportError } from "../../src/ingestion/source-catalog.ts";
import { inspectSourceArtifact, repairSourceArtifact } from "../../src/ingestion/source-repair.ts";
import { createTrademarkIngestion } from "../../src/ingestion/trademark-ingestion.ts";
import { createMarksService } from "../../src/services/marks-service.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}
const database = postgres(databaseUrl, { max: 2, prepare: false });
const removed: string[] = [];
const store = {
  async *listObjectKeys() {
    yield* [];
  },
  openFile: async () => "/ignored/annual.zip",
  put: async () => ({ bytes: 1, objectKey: "sha256/object", sha256: "a".repeat(64) }),
  remove: (key: string) => {
    removed.push(key);
    return Promise.resolve();
  },
};
const unavailableSource = {
  discover: () => Promise.reject(new Error("unexpected discovery")),
  download: () => Promise.reject(new Error("unexpected download")),
};
function ingestion(
  extractXml = () => Promise.resolve(Readable.from([sourceDocument(validRecord)]))
) {
  return createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml,
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: unavailableSource,
  });
}
const sha = "a".repeat(64);
const validRecord =
  "<case-file><serial-number>74668071</serial-number><registration-number>1974886</registration-number><transaction-date>20230825</transaction-date><case-file-header><filing-date>19950501</filing-date><registration-date>19960521</registration-date><status-code>800</status-code><status-date>20160607</status-date><mark-identification>GUESS JEANS</mark-identification><mark-drawing-code>1</mark-drawing-code></case-file-header><classifications><international-code>025</international-code><status-code>6</status-code><status-date>19950706</status-date><primary-code>025</primary-code></classifications><case-file-statements><case-file-statement><type-code>GS0251</type-code><text>shirts</text></case-file-statement></case-file-statements></case-file>";
function sourceDocument(record: string) {
  return `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><application-information><file-segments><file-segment>1</file-segment><action-keys><action-key>TX</action-key>${record}</action-keys></file-segments></application-information></trademark-applications-daily>`;
}
function dailyDiscovery(dates: string[]) {
  return {
    artifacts: dates.map((date) => ({
      bytes: 1,
      downloadUrl: `https://example.test/apc${date.slice(2).replaceAll("-", "")}.zip`,
      filename: `apc${date.slice(2).replaceAll("-", "")}.zip`,
      fromDate: date,
      lastModifiedAt: "2026-01-03T00:00:00Z",
      releaseDate: "2026-01-03",
      toDate: date,
    })),
    product: {
      frequency: "DAILY",
      identifier: "TRTDXFAP",
      lastModifiedAt: "2026-01-03T00:00:00Z",
      title: "Trademark Full Text XML Data (No Images) – Daily Applications",
    },
    responseState: { status: 200 },
  };
}
async function seedArtifact(
  index: number,
  state: "complete" | "downloading" | "pending" | "projecting",
  objectKey: string | null = null
) {
  const downloadStates = {
    complete: "complete",
    downloading: "downloading",
    pending: "pending",
    projecting: "complete",
  } as const;
  const projectionStates = {
    complete: "complete",
    downloading: "pending",
    pending: "pending",
    projecting: "projecting",
  } as const;
  const downloadState = downloadStates[state];
  const projectionState = projectionStates[state];
  await database`
    insert into source_artifact (id, product, filename, download_url, expected_bytes,
      source_from_date, source_to_date, download_state, projection_state, projection_version,
      sha256, object_key)
    values (${`71000000-0000-4000-8000-${String(index).padStart(12, "0")}`}, 'TRTYRAP',
      ${`annual-${String(index).padStart(2, "0")}.zip`},
      ${`https://example.test/annual-${String(index).padStart(2, "0")}.zip`}, 1,
      '1884-04-07', '2025-12-31', ${downloadState}, ${projectionState},
      ${projectionState === "complete" ? "uspto-projection-v1" : null}, ${sha}, ${objectKey})
  `;
}
async function seedCompletedAnnualBaseline(completeThroughDate: string) {
  await Promise.all(Array.from({ length: 91 }, (_, index) => seedArtifact(index + 1, "complete")));
  await database`
    update data_state set complete_through_date = ${completeThroughDate} where id = 'uspto'
  `;
}
async function seedMark(
  wordMark: string,
  sourceFilename = "annual.zip",
  sourceTransactionDate: string | null = null
) {
  await database`insert into mark (serial_number, word_mark, status_code, normalization_version, source_product, source_filename, source_sha256, source_physical_record_index, source_transaction_date) values ('74668071', ${wordMark}, '800', 'uspto-normalization-v1', 'TRTYRAP', ${sourceFilename}, ${sha}, 1, ${sourceTransactionDate})`;
}
async function seedLiveMark(wordMark: string, sourceTransactionDate: string | null, goods: string) {
  await seedMark(wordMark, "existing.zip", sourceTransactionDate);
  await database`
    insert into mark_class (serial_number, ordinal, international_code, source_product,
      source_filename, source_sha256, source_physical_record_index)
    values ('74668071', 1, '025', 'TRTYRAP', 'existing.zip', ${sha}, 1)
  `;
  await database`
    insert into mark_goods_services (serial_number, ordinal, type_code, text, source_product,
      source_filename, source_sha256, source_physical_record_index)
    values ('74668071', 1, 'GS0251', ${goods}, 'TRTYRAP', 'existing.zip', ${sha}, 1)
  `;
}
function competingRecord(options: {
  goods: string;
  primaryCode: string;
  transactionDate: string | null;
  wordMark: string;
}) {
  const transactionDate = options.transactionDate
    ? `<transaction-date>${options.transactionDate}</transaction-date>`
    : "";
  return `<case-file><serial-number>74668071</serial-number>${transactionDate}<case-file-header><filing-date>19950501</filing-date><status-code>800</status-code><status-date>20160607</status-date><mark-identification>${options.wordMark}</mark-identification><mark-drawing-code>1</mark-drawing-code></case-file-header><classifications><international-code>${options.primaryCode}</international-code><status-code>6</status-code><primary-code>${options.primaryCode}</primary-code></classifications><case-file-statements><case-file-statement><type-code>GS0251</type-code><text>${options.goods}</text></case-file-statement></case-file-statements></case-file>`;
}
async function seedDailyArtifact(index: number, filename: string, sourceDate: string) {
  await database`
    insert into source_artifact (id, product, filename, download_url, expected_bytes,
      source_from_date, source_to_date, download_state, projection_state, sha256, object_key)
    values (${`72000000-0000-4000-8000-${String(index).padStart(12, "0")}`}, 'TRTDXFAP',
      ${filename}, 'https://example.test/daily.zip', 1, ${sourceDate}, ${sourceDate},
      'complete', 'projecting', ${sha}, ${`sha256/daily-${index}`})
  `;
}

beforeEach(async () => {
  removed.length = 0;
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});
afterAll(() => database.end({ timeout: 1 }));

test("an empty database returns empty data instead of an availability error", async () => {
  const marks = createMarksService(database);
  expect(
    await marks.search({
      limit: 25,
      match: "both",
      mode: "multi",
      offset: 0,
      query: "nothing",
      registered: "all",
      sort: "relevance",
      status: "all",
      type: "all",
    })
  ).toEqual({
    items: [],
    limit: 25,
    liveMatchCounts: { exact: 0, partial: 0 },
    meta: { dataThroughDate: null, dataVersion: "0" },
    offset: 0,
    total: 0,
  });
  expect(await marks.getBySerialNumber("99999999")).toBeNull();
  expect(await marks.getByRegistrationNumber("9999999")).toBeNull();
});

test("discovers only the exact pinned annual baseline", async () => {
  const sourceCatalog = {
    discover: async () => ({
      artifacts: [...annualBaselineV1Artifacts].map((filename) => ({
        bytes: 1,
        downloadUrl: `https://example.test/${filename}`,
        filename,
        fromDate: "1884-04-07",
        lastModifiedAt: "2026-01-01T00:00:00Z",
        releaseDate: "2026-01-01",
        toDate: "2025-12-31",
      })),
      product: {
        frequency: "YEARLY",
        identifier: "TRTYRAP",
        lastModifiedAt: "2026-01-01T00:00:00Z",
        title: "Annual",
      },
      responseState: { status: 200 },
    }),
    download: unavailableSource.download,
  };
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog,
  });
  expect(await module.reconcile()).toMatchObject({ action: "discovered", artifactCount: 91 });
  expect((await module.status()).pendingArtifactCount).toBe(91);
});

test("discovers contiguous daily artifacts after the annual baseline", async () => {
  await seedCompletedAnnualBaseline("2025-12-31");
  const sourceCatalog = {
    discover: async () => dailyDiscovery(["2026-01-01", "2026-01-02"]),
    download: unavailableSource.download,
  };
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog,
  });

  expect(await module.reconcile()).toMatchObject({
    action: "discovered",
    artifactCount: 2,
    product: "TRTDXFAP",
  });
  expect([
    ...(await database`select filename from source_artifact where product = 'TRTDXFAP' order by filename`),
  ]).toEqual([{ filename: "apc260101.zip" }, { filename: "apc260102.zip" }]);
});

test("continues from durable coverage after old daily members roll out", async () => {
  await seedCompletedAnnualBaseline("2027-07-15");
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: async () => dailyDiscovery(["2027-07-16", "2027-07-17"]),
      download: unavailableSource.download,
    },
  });

  expect(await module.reconcile()).toMatchObject({
    action: "discovered",
    artifactCount: 2,
    product: "TRTDXFAP",
  });
  expect([
    ...(await database`select filename from source_artifact where product = 'TRTDXFAP' order by filename`),
  ]).toEqual([{ filename: "apc270716.zip" }, { filename: "apc270717.zip" }]);
});

test("accepts a caught-up daily catalog with no newer member", async () => {
  await seedCompletedAnnualBaseline("2027-07-17");
  await database`
    insert into source_artifact (id, product, filename, download_url, expected_bytes,
      source_from_date, source_to_date, download_state, projection_state, projection_version)
    values
      ('72000000-0000-4000-8000-000000000016', 'TRTDXFAP', 'apc270716.zip',
        'https://example.test/apc270716.zip', 1, '2027-07-16', '2027-07-16',
        'complete', 'complete', 'uspto-projection-v1'),
      ('72000000-0000-4000-8000-000000000017', 'TRTDXFAP', 'apc270717.zip',
        'https://example.test/apc270717.zip', 1, '2027-07-17', '2027-07-17',
        'complete', 'complete', 'uspto-projection-v1')
  `;
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: async () => dailyDiscovery(["2027-07-16", "2027-07-17"]),
      download: unavailableSource.download,
    },
  });

  expect(await module.reconcile()).toEqual({
    action: "discovered",
    artifactCount: 0,
    product: "TRTDXFAP",
  });
  expect((await module.status()).lane).toMatchObject({ failureCount: 0, status: "ready" });
});

test("stops daily discovery at a real gap after durable coverage", async () => {
  await seedCompletedAnnualBaseline("2027-07-15");
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: async () => dailyDiscovery(["2027-07-16", "2027-07-18"]),
      download: unavailableSource.download,
    },
  });

  expect(await module.reconcile()).toEqual({ action: "provider-stopped" });
  expect([
    ...(await database`select filename from source_artifact where product = 'TRTDXFAP'`),
  ]).toEqual([]);
  expect((await module.status()).lane).toMatchObject({
    currentError: "Daily catalog is not contiguous at 2027-07-17",
    failureCount: 1,
    status: "stopped",
  });
});

test("a later daily projection cannot advance freshness past an incomplete day", async () => {
  await seedCompletedAnnualBaseline("2025-12-31");
  await database`
    insert into source_artifact (id, product, filename, download_url, expected_bytes,
      source_from_date, source_to_date, download_state, download_error, projection_state,
      sha256, object_key)
    values
      ('72000000-0000-4000-8000-000000000101', 'TRTDXFAP', 'apc260101.zip',
        'https://example.test/apc260101.zip', 1, '2026-01-01', '2026-01-01', 'failed',
        'USPTO ODP download redirect failed with HTTP 429', 'pending', null, null),
      ('72000000-0000-4000-8000-000000000102', 'TRTDXFAP', 'apc260102.zip',
        'https://example.test/apc260102.zip', 1, '2026-01-02', '2026-01-02', 'complete',
        null, 'projecting', ${sha}, 'sha256/object')
  `;

  expect(await ingestion().reconcile()).toMatchObject({
    action: "projected",
    filename: "apc260102.zip",
  });
  expect((await ingestion().status()).completeThroughDate).toBe("2025-12-31");
  expect(
    await database`select serial_number from mark where serial_number = '74668071'`
  ).toHaveLength(1);
});

test("pins the exact official daily product title", async () => {
  await seedCompletedAnnualBaseline("2025-12-31");
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: () =>
        Promise.resolve({
          artifacts: [
            {
              bytes: 1,
              downloadUrl: "https://example.test/apc260101.zip",
              filename: "apc260101.zip",
              fromDate: "2026-01-01",
              lastModifiedAt: "2026-01-02T00:00:00Z",
              releaseDate: "2026-01-02",
              toDate: "2026-01-01",
            },
          ],
          product: {
            frequency: "DAILY",
            identifier: "TRTDXFAP",
            lastModifiedAt: "2026-01-02T00:00:00Z",
            title: "Daily Applications",
          },
          responseState: { status: 200 },
        }),
      download: unavailableSource.download,
    },
  });

  expect(await module.reconcile()).toEqual({ action: "provider-stopped" });
  expect((await module.status()).lane).toMatchObject({
    currentError: "Daily catalog returned the wrong product contract",
    failureCount: 1,
    status: "stopped",
  });
});

test("stops discovery when a retained daily artifact changes identity", async () => {
  await seedCompletedAnnualBaseline("2026-01-01");
  await database`
    insert into source_artifact (id, product, filename, download_url, expected_bytes,
      source_from_date, source_to_date, download_state, projection_state, projection_version, sha256)
    values ('72000000-0000-4000-8000-000000000001', 'TRTDXFAP', 'apc260101.zip',
      'https://example.test/apc260101.zip', 1, '2026-01-01', '2026-01-01',
      'complete', 'complete', 'uspto-projection-v1', ${sha})
  `;
  let discoveryCount = 0;
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: () => {
        discoveryCount += 1;
        return Promise.resolve({
          artifacts: [
            {
              bytes: 2,
              downloadUrl: "https://example.test/apc260101.zip",
              filename: "apc260101.zip",
              fromDate: "2026-01-01",
              lastModifiedAt: "2026-01-02T00:00:00Z",
              releaseDate: "2026-01-02",
              toDate: "2026-01-01",
            },
          ],
          product: {
            frequency: "DAILY",
            identifier: "TRTDXFAP",
            lastModifiedAt: "2026-01-02T00:00:00Z",
            title: "Trademark Full Text XML Data (No Images) – Daily Applications",
          },
          responseState: { status: 200 },
        });
      },
      download: unavailableSource.download,
    },
  });

  expect(await module.reconcile()).toEqual({ action: "provider-stopped" });
  expect(await module.reconcile()).toEqual({ action: "provider-stopped" });
  expect(discoveryCount).toBe(1);
  expect((await module.status()).lane).toMatchObject({
    currentError: "Source catalog changed retained artifact identity: apc260101.zip",
    failureCount: 1,
    status: "stopped",
  });
});

test("removes one unreferenced raw ZIP before starting source work", async () => {
  const orphanStore = {
    ...store,
    async *listObjectKeys() {
      await Promise.resolve();
      yield "sha256/orphan";
    },
  };
  const module = createTrademarkIngestion({
    artifactStore: orphanStore,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: unavailableSource,
  });
  expect(await module.reconcile()).toEqual({
    action: "cleanup-orphan",
    objectKey: "sha256/orphan",
  });
  expect(removed).toEqual(["sha256/orphan"]);
});

test("retries cleanup for one completed file before starting source work", async () => {
  await seedArtifact(1, "complete", "sha256/object");

  expect(await ingestion().reconcile()).toMatchObject({
    action: "cleanup-artifact",
    objectKey: "sha256/object",
  });
  expect(removed).toEqual(["sha256/object"]);
  expect([
    ...(await database`select object_key from source_artifact where filename = 'annual-01.zip'`),
  ]).toEqual([{ object_key: null }]);
});

test("returns live rows while the annual baseline is incomplete", async () => {
  await Promise.all(Array.from({ length: 90 }, (_, index) => seedArtifact(index + 1, "complete")));
  await seedMark("LIVE PARTIAL MARK");
  expect(await ingestion().reconcile()).toEqual({ action: "idle" });
  const page = await createMarksService(database).search({
    limit: 25,
    match: "exact",
    mode: "multi",
    offset: 0,
    query: "LIVE PARTIAL MARK",
    registered: "all",
    sort: "relevance",
    status: "all",
    type: "all",
  });
  expect(page.total).toBe(1);
  expect(page.meta).toEqual({ dataThroughDate: null, dataVersion: "0" });
  const exact = await createMarksService(database).getBySerialNumber("74668071");
  expect(exact).toMatchObject({
    mark: { serialNumber: "74668071", wordMark: "LIVE PARTIAL MARK" },
    provenance: {
      contributors: [
        {
          artifactVersionSha256: sha,
          claimPath: "case-file",
          physicalRecordIndex: 1,
          product: "TRTYRAP",
        },
      ],
    },
  });
  expect((await ingestion().status()).dataVersion).toBe(0);
});

test("downloads once and deletes the verified ZIP after successful projection", async () => {
  await seedArtifact(1, "pending");
  let downloadCount = 0;
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([sourceDocument(validRecord)])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: () => {
        downloadCount += 1;
        return Promise.resolve({
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              controller.close();
            },
          }),
          expectedBytes: 1,
          responseState: { requestId: "download-1", status: 200 },
        });
      },
    },
  });

  expect(await module.reconcile()).toMatchObject({ action: "downloaded" });
  const [downloaded] = await database<
    Array<{
      downloadResponseState: { requestId: string; status: number };
      downloadState: string;
      objectKey: string | null;
      projectionState: string;
    }>
  >`
    select download_state as "downloadState", projection_state as "projectionState",
      download_response_state as "downloadResponseState", object_key as "objectKey"
    from source_artifact
  `;
  expect(downloaded).toEqual({
    downloadResponseState: { requestId: "download-1", status: 200 },
    downloadState: "complete",
    objectKey: "sha256/object",
    projectionState: "pending",
  });

  expect(await module.reconcile()).toMatchObject({ action: "projected" });
  const [projected] = await database<
    Array<{
      downloadState: string;
      objectKey: string | null;
      projectionState: string;
      projectionVersion: string | null;
    }>
  >`
    select download_state as "downloadState", projection_state as "projectionState",
      projection_version as "projectionVersion", object_key as "objectKey"
    from source_artifact
  `;
  expect(projected).toEqual({
    downloadState: "complete",
    objectKey: null,
    projectionState: "complete",
    projectionVersion: "uspto-projection-v1",
  });
  expect(downloadCount).toBe(1);
  expect(removed).toEqual(["sha256/object"]);
});

test("restart resumes one projecting artifact from its retained ZIP", async () => {
  await seedArtifact(1, "projecting", "sha256/object");
  await seedMark("STALE PARTITION ROW", "annual-01.zip");
  await database`
    insert into mark_class (serial_number, ordinal, international_code, source_product,
      source_filename, source_sha256, source_physical_record_index)
    values ('74668071', 1, '999', 'TRTYRAP', 'annual-01.zip', ${sha}, 1)
  `;
  expect(await ingestion().reconcile()).toMatchObject({
    action: "projected",
    materialChangeCount: 2,
    physicalRecordCount: 1,
    projectedMarkCount: 1,
  });
  expect(removed).toEqual(["sha256/object"]);
  expect(await ingestion().reconcile()).toEqual({ action: "idle" });
  const [artifact] = await database<
    Array<{ objectKey: string | null; projectionState: string }>
  >`select object_key as "objectKey", projection_state as "projectionState" from source_artifact`;
  expect(artifact).toEqual({ objectKey: null, projectionState: "complete" });
  expect(await database`select serial_number from mark`).toHaveLength(1);
  expect([...(await database`select international_code from mark_class order by ordinal`)]).toEqual(
    [{ international_code: "025" }]
  );
  expect([...(await database`select word_mark from mark`)]).toEqual([{ word_mark: "GUESS JEANS" }]);
  expect((await ingestion().status()).dataVersion).toBe(1);
});

test("ingests and exactly matches a normalized word mark beyond B-tree tuple limits", async () => {
  const wordMark = `LONG ${"X".repeat(5000)}`;
  await seedArtifact(1, "projecting", "sha256/object");
  const record = validRecord.replace("GUESS JEANS", wordMark);

  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(record)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 1, projectedMarkCount: 1 });
  const [stored] = await database<Array<{ normalizedBytes: number }>>`
    select octet_length(word_mark_normalized)::int as "normalizedBytes" from mark
  `;
  expect(stored?.normalizedBytes).toBeGreaterThan(3720);

  const page = await createMarksService(database).search({
    limit: 25,
    match: "exact",
    mode: "multi",
    offset: 0,
    query: wordMark,
    registered: "all",
    sort: "relevance",
    status: "all",
    type: "all",
  });
  expect(page).toMatchObject({
    items: [{ match: "exact", serialNumber: "74668071", wordMark }],
    total: 1,
  });
  expect(removed).toEqual(["sha256/object"]);
});

test("daily records update and remove live Class 025 identities immediately", async () => {
  const before = await readFile("fixtures/uspto/records/publication-before-79366581.xml", "utf8");
  const after = await readFile("fixtures/uspto/records/publication-after-79366581.xml", "utf8");
  await seedDailyArtifact(1, "apc240914.zip", "2024-09-14");
  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(before)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 1, projectedMarkCount: 1 });
  expect(
    await database`select serial_number from mark where serial_number = '79366581'`
  ).toHaveLength(1);
  expect(
    await database`
      select international_code from mark_class
      where serial_number = '79366581' and international_code = '025'
    `
  ).toHaveLength(1);

  await seedDailyArtifact(2, "apc240925.zip", "2024-09-25");
  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(after)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 1, projectedMarkCount: 0 });
  expect([
    ...(await database`select serial_number from mark where serial_number = '79366581'`),
  ]).toEqual([]);
  expect((await ingestion().status()).dataVersion).toBe(2);
  expect(removed).toEqual(["sha256/daily-1", "sha256/daily-2"]);
});

test("an equal-date daily removal cannot delete live state", async () => {
  await seedLiveMark("ORIGINAL MARK", "2025-01-01", "original shirts");
  await seedDailyArtifact(1, "apc250101.zip", "2025-01-01");
  const competitor = competingRecord({
    goods: "unrelated goods",
    primaryCode: "009",
    transactionDate: "20250101",
    wordMark: "REMOVE COMPETITOR",
  });

  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(competitor)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 0, projectedMarkCount: 0 });
  expect([...(await database`select word_mark from mark`)]).toEqual([
    { word_mark: "ORIGINAL MARK" },
  ]);
  expect([...(await database`select text from mark_goods_services`)]).toEqual([
    { text: "original shirts" },
  ]);
});

test("a null-date competitor cannot replace null-date live state or children", async () => {
  await seedLiveMark("ORIGINAL MARK", null, "original shirts");
  await seedDailyArtifact(1, "apc250101.zip", "2025-01-01");
  const competitor = competingRecord({
    goods: "competitor shirts",
    primaryCode: "025",
    transactionDate: null,
    wordMark: "UNKNOWN DATE COMPETITOR",
  });

  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(competitor)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 0, projectedMarkCount: 1 });
  expect([...(await database`select word_mark, source_filename from mark`)]).toEqual([
    { source_filename: "existing.zip", word_mark: "ORIGINAL MARK" },
  ]);
  expect([...(await database`select text from mark_goods_services`)]).toEqual([
    { text: "original shirts" },
  ]);
});

test("a dated upsert or removal supersedes unknown live ordering", async () => {
  await seedLiveMark("ORIGINAL MARK", null, "original shirts");
  await seedDailyArtifact(1, "apc250102.zip", "2025-01-02");
  const competitor = competingRecord({
    goods: "new shirts",
    primaryCode: "025",
    transactionDate: "20250102",
    wordMark: "DATED COMPETITOR",
  });

  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(competitor)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 1, projectedMarkCount: 1 });
  expect([...(await database`select word_mark, source_transaction_date::text from mark`)]).toEqual([
    { source_transaction_date: "2025-01-02", word_mark: "DATED COMPETITOR" },
  ]);
  expect([...(await database`select text from mark_goods_services`)]).toEqual([
    { text: "new shirts" },
  ]);

  await database`update mark set source_transaction_date = null`;
  await seedDailyArtifact(2, "apc250103.zip", "2025-01-03");
  const removal = competingRecord({
    goods: "unrelated goods",
    primaryCode: "009",
    transactionDate: "20250103",
    wordMark: "DATED COMPETITOR",
  });
  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(removal)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 1, projectedMarkCount: 0 });
  expect(await database`select serial_number from mark`).toHaveLength(0);
});

test("genuine newer upserts and removals still replace live state", async () => {
  await seedLiveMark("ORIGINAL MARK", "2025-01-01", "original shirts");
  await seedDailyArtifact(1, "apc250102.zip", "2025-01-02");
  const update = competingRecord({
    goods: "updated shirts",
    primaryCode: "025",
    transactionDate: "20250102",
    wordMark: "NEWER MARK",
  });
  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(update)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 1, projectedMarkCount: 1 });

  await seedDailyArtifact(2, "apc250103.zip", "2025-01-03");
  const removal = competingRecord({
    goods: "unrelated goods",
    primaryCode: "009",
    transactionDate: "20250103",
    wordMark: "NEWER MARK",
  });
  expect(
    await ingestion(() => Promise.resolve(Readable.from([sourceDocument(removal)]))).reconcile()
  ).toMatchObject({ action: "projected", materialChangeCount: 1, projectedMarkCount: 0 });
  expect(await database`select serial_number from mark`).toHaveLength(0);
});

test("bounds expanded status-event writes without losing event data", async () => {
  await seedArtifact(1, "projecting", "sha256/object");
  const events = Array.from(
    { length: 40 },
    (_, index) =>
      `<case-file-event-statement><code>E${String(index).padStart(2, "0")}</code><type>S</type><description-text>STATUS ${index}</description-text><date>20250101</date><number>${index + 1}</number></case-file-event-statement>`
  ).join("");
  const records = Array.from({ length: 100 }, (_, index) => {
    const serial = String(80_000_000 + index);
    return `<case-file><serial-number>${serial}</serial-number><transaction-date>20250101</transaction-date><case-file-header><filing-date>20250101</filing-date><status-code>600</status-code><status-date>20250101</status-date><mark-identification>EVENT MARK ${index}</mark-identification></case-file-header><case-file-event-statements>${events}</case-file-event-statements><classifications><international-code>025</international-code><status-code>6</status-code><status-date>20250101</status-date><primary-code>025</primary-code></classifications></case-file>`;
  }).join("");
  await database.unsafe(`
    create function reject_unbounded_status_event_insert() returns trigger language plpgsql as $$
    begin
      if (select count(*) from inserted_events) > 250 then
        raise exception 'unbounded status-event insert';
      end if;
      return null;
    end;
    $$;
    create trigger reject_unbounded_status_event_insert after insert on mark_status_event
    referencing new table as inserted_events for each statement
    execute function reject_unbounded_status_event_insert();
  `);
  try {
    expect(
      await ingestion(() => Promise.resolve(Readable.from([sourceDocument(records)]))).reconcile()
    ).toMatchObject({
      action: "projected",
      physicalRecordCount: 100,
      projectedMarkCount: 100,
    });
  } finally {
    await database`drop trigger if exists reject_unbounded_status_event_insert on mark_status_event`;
    await database`drop function if exists reject_unbounded_status_event_insert()`;
  }

  const [counts] = await database<Array<{ eventCount: number; markCount: number }>>`
    select count(distinct serial_number)::int as "markCount", count(*)::int as "eventCount"
    from mark_status_event
  `;
  const [firstMark] = await database<Array<{ eventNumbers: string[] }>>`
    select array_agg(event_number order by event_number::int) as "eventNumbers"
    from mark_status_event where serial_number = '80000000'
  `;
  expect(counts).toEqual({ eventCount: 4000, markCount: 100 });
  expect(firstMark?.eventNumbers).toEqual(
    Array.from({ length: 40 }, (_, index) => String(index + 1))
  );
  expect(removed).toEqual(["sha256/object"]);
});

test("projection failure retains the ZIP and records projection state separately", async () => {
  await seedArtifact(1, "projecting", "sha256/object");
  const broken = async () =>
    Readable.from([sourceDocument("<case-file><serial-number>bad</serial-number></case-file>")]);
  expect(await ingestion(broken).reconcile()).toMatchObject({
    action: "artifact-projection-failed",
    reason: expect.stringContaining("serial-number"),
  });
  expect(removed).toEqual([]);
  const [artifact] = await database<
    Array<{ objectKey: string | null; projectionError: string; projectionState: string }>
  >`
    select projection_error as "projectionError", object_key as "objectKey",
      projection_state as "projectionState" from source_artifact
  `;
  expect(artifact).toMatchObject({
    objectKey: "sha256/object",
    projectionError: expect.stringContaining("serial-number"),
    projectionState: "failed",
  });
  expect((await ingestion(broken).status()).failedArtifactUpdatedAt).toBeInstanceOf(Date);
});

test("a projection-version change replays a failed artifact without downloading", async () => {
  await seedArtifact(1, "projecting", "sha256/object");
  const broken = () =>
    Promise.resolve(
      Readable.from([sourceDocument("<case-file><serial-number>bad</serial-number></case-file>")])
    );
  expect(await ingestion(broken).reconcile()).toMatchObject({
    action: "artifact-projection-failed",
  });
  await database`
    update source_artifact set projection_version = 'uspto-projection-v0'
  `;
  let downloadCount = 0;
  const replay = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([sourceDocument(validRecord)])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: () => {
        downloadCount += 1;
        return Promise.reject(new Error("retained projection must not download"));
      },
    },
  });

  expect(await replay.reconcile()).toMatchObject({ action: "projected", projectedMarkCount: 1 });
  expect(downloadCount).toBe(0);
  expect(removed).toEqual(["sha256/object"]);
  expect([
    ...(await database`
      select object_key from source_artifact
      where projection_state = 'complete' and projection_version = 'uspto-projection-v1'
    `),
  ]).toEqual([{ object_key: null }]);
});

test("a successful cleaned artifact is not replayed automatically", async () => {
  await seedArtifact(1, "projecting", "sha256/object");
  expect(await ingestion().reconcile()).toMatchObject({ action: "projected" });
  await database`
    update source_artifact set projection_version = 'uspto-projection-v0'
  `;
  let downloadCount = 0;
  const replay = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([sourceDocument(validRecord)])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: () => {
        downloadCount += 1;
        return Promise.reject(new Error("retained projection must not download"));
      },
    },
  });

  expect((await replay.status()).pendingArtifactCount).toBe(0);
  expect(await replay.reconcile()).toEqual({ action: "idle" });
  expect(downloadCount).toBe(0);
  expect(removed).toEqual(["sha256/object"]);
  expect(
    await database`select serial_number from mark where serial_number = '74668071'`
  ).toHaveLength(1);
});

test("restart fails an interrupted download without fetching it again", async () => {
  await seedArtifact(1, "downloading");
  let downloadCount = 0;
  const sourceCatalog = {
    discover: unavailableSource.discover,
    download: () => {
      downloadCount += 1;
      return Promise.reject(new Error("must not redownload"));
    },
  };
  const restartedIngestion = () =>
    createTrademarkIngestion({
      artifactStore: store,
      database,
      extractXml: () => Promise.resolve(Readable.from([])),
      retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
      sourceCatalog,
    });

  expect(await restartedIngestion().reconcile()).toMatchObject({
    action: "artifact-download-failed",
    reason: "Download interrupted before retention",
  });
  expect(downloadCount).toBe(0);
  const [artifact] = await database<
    Array<{ downloadError: string | null; downloadState: string; objectKey: string | null }>
  >`
    select download_error as "downloadError", download_state as "downloadState",
      object_key as "objectKey" from source_artifact
  `;
  expect(artifact).toEqual({
    downloadError: "Download interrupted before retention",
    downloadState: "failed",
    objectKey: null,
  });
});

test("a failed download is recorded once and is never requested automatically again", async () => {
  await seedArtifact(1, "pending");
  let downloadCount = 0;
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: () => {
        downloadCount += 1;
        return Promise.reject(new SourceTransportError("interrupted"));
      },
    },
  });

  expect(await module.reconcile()).toMatchObject({ action: "artifact-download-failed" });
  expect(await module.reconcile()).toEqual({ action: "idle" });
  expect(downloadCount).toBe(1);
  expect([
    ...(await database`
      select download_request_count, download_state from source_artifact
      where filename = 'annual-01.zip'
    `),
  ]).toEqual([{ download_request_count: 1, download_state: "failed" }]);
});

test("one-file repair re-arms only the approved download after provider backoff", async () => {
  await database`
    insert into source_lane (id, status, next_eligible_at)
    values ('uspto-odp', 'backoff', now() - interval '1 second')
  `;
  await seedArtifact(1, "pending");
  await seedArtifact(2, "pending");
  await database`
    update source_artifact set download_state = 'failed', download_request_count = 1,
      download_error = 'HTTP 429', download_response_state = '{"status":429}'::jsonb,
      sha256 = null
  `;

  expect(
    await inspectSourceArtifact(store, database, {
      filename: "annual-01.zip",
      product: "TRTYRAP",
    })
  ).toMatchObject({
    downloadRequestCount: 1,
    downloadState: "failed",
    hasRetainedZip: false,
    sourceLaneStatus: "backoff",
  });
  expect(
    await repairSourceArtifact(store, database, {
      action: "reacquire",
      filename: "annual-01.zip",
      product: "TRTYRAP",
    })
  ).toMatchObject({
    downloadError: null,
    downloadRequestCount: 1,
    downloadResponseState: null,
    downloadState: "pending",
  });
  expect([
    ...(await database`
      select filename, download_request_count, download_state from source_artifact
      order by filename
    `),
  ]).toEqual([
    { download_request_count: 1, download_state: "pending", filename: "annual-01.zip" },
    { download_request_count: 1, download_state: "failed", filename: "annual-02.zip" },
  ]);
});

test("repair rejects cleaned history and a stale retained pointer", async () => {
  await database`insert into source_lane (id, status) values ('uspto-odp', 'ready')`;
  await seedArtifact(1, "complete");
  await database`
    update source_artifact set download_request_count = 1 where filename = 'annual-01.zip'
  `;
  await expect(
    repairSourceArtifact(store, database, {
      action: "reacquire",
      filename: "annual-01.zip",
      product: "TRTYRAP",
    })
  ).rejects.toThrow("requires content-revision support");

  await seedArtifact(2, "complete", "sha256/stale");
  await database`
    update source_artifact set bytes = 1 where filename = 'annual-02.zip'
  `;
  await expect(
    inspectSourceArtifact(
      { ...store, openFile: () => Promise.reject(new Error("missing retained ZIP")) },
      database,
      { filename: "annual-02.zip", product: "TRTYRAP" }
    )
  ).rejects.toThrow("missing retained ZIP");
});

test("repair rejects retained bytes whose SHA-256 no longer matches", async () => {
  await database`insert into source_lane (id, status) values ('uspto-odp', 'ready')`;
  const directory = await mkdtemp(join(tmpdir(), "tmturtle-repair-"));
  const path = join(directory, "annual.zip");
  await writeFile(path, "wrong");
  await seedArtifact(1, "complete", "sha256/stale");
  await database`
    update source_artifact set bytes = 5, projection_state = 'failed'
    where filename = 'annual-01.zip'
  `;
  try {
    await expect(
      repairSourceArtifact({ ...store, openFile: () => Promise.resolve(path) }, database, {
        action: "replay",
        filename: "annual-01.zip",
        product: "TRTYRAP",
      })
    ).rejects.toThrow("retained ZIP SHA-256 does not match");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("repair reports and respects a stopped USPTO lane", async () => {
  await database`
    insert into source_lane (id, status, current_error)
    values ('uspto-odp', 'stopped', 'Provider authorization failed')
  `;
  await seedArtifact(1, "pending");
  await database`
    update source_artifact set download_state = 'failed' where filename = 'annual-01.zip'
  `;
  expect(
    await inspectSourceArtifact(store, database, {
      filename: "annual-01.zip",
      product: "TRTYRAP",
    })
  ).toMatchObject({
    sourceLaneError: "Provider authorization failed",
    sourceLaneStatus: "stopped",
  });
  await expect(
    repairSourceArtifact(store, database, {
      action: "reacquire",
      filename: "annual-01.zip",
      product: "TRTYRAP",
    })
  ).rejects.toThrow("requires an available USPTO lane");

  const directory = await mkdtemp(join(tmpdir(), "tmturtle-replay-"));
  const path = join(directory, "annual.zip");
  const bytes = "valid";
  await writeFile(path, bytes);
  await database`
    update source_artifact set download_state = 'complete', object_key = 'sha256/valid',
      bytes = ${bytes.length}, sha256 = ${createHash("sha256").update(bytes).digest("hex")},
      projection_state = 'failed'
    where filename = 'annual-01.zip'
  `;
  try {
    expect(
      await repairSourceArtifact({ ...store, openFile: () => Promise.resolve(path) }, database, {
        action: "replay",
        filename: "annual-01.zip",
        product: "TRTYRAP",
      })
    ).toMatchObject({ projectionState: "pending", sourceLaneStatus: "stopped" });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("restart skips unavailable legacy bytes and downloads the next pending artifact", async () => {
  await seedArtifact(1, "complete");
  await database`
    update source_artifact set download_state = 'unavailable',
      download_error = 'Retained ZIP unavailable from pre-retention ingestion'
    where filename = 'annual-01.zip'
  `;
  await seedArtifact(2, "pending");
  const downloadedUrls: string[] = [];
  const restarted = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.reject(new Error("unavailable bytes must not be projected")),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: (downloadUrl: string) => {
        downloadedUrls.push(downloadUrl);
        return Promise.resolve({
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              controller.close();
            },
          }),
          expectedBytes: 1,
          responseState: { status: 200 },
        });
      },
    },
  });

  expect(await restarted.reconcile()).toMatchObject({
    action: "downloaded",
    filename: "annual-02.zip",
  });
  expect(downloadedUrls).toEqual(["https://example.test/annual-02.zip"]);
  expect([
    ...(await database`
      select download_state, projection_state from source_artifact where filename = 'annual-01.zip'
    `),
  ]).toEqual([{ download_state: "unavailable", projection_state: "complete" }]);
});

test("blocks one file after a catalog length mismatch", async () => {
  await seedArtifact(1, "pending");
  let downloadCount = 0;
  const sourceCatalog = {
    discover: unavailableSource.discover,
    download: () => {
      downloadCount += 1;
      return Promise.resolve({
        body: new ReadableStream<Uint8Array>(),
        expectedBytes: 2,
        responseState: { status: 200 },
      });
    },
  };
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog,
  });

  expect(await module.reconcile()).toMatchObject({ action: "artifact-download-failed" });
  expect(await module.reconcile()).toEqual({ action: "idle" });
  expect(downloadCount).toBe(1);
});

test("atomically resets old provider failures with a committed download", async () => {
  await seedArtifact(1, "pending");
  await database`
    insert into source_lane (id, status, failure_count, current_error, next_eligible_at)
    values ('uspto-odp', 'backoff', 7, 'old failure', '2025-01-01T00:00:00Z')
  `;
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: () =>
        Promise.resolve({
          body: new ReadableStream<Uint8Array>(),
          expectedBytes: 1,
          responseState: { status: 200 },
        }),
    },
  });

  expect(await module.reconcile()).toMatchObject({ action: "downloaded" });
  const [state] = await database<
    Array<{
      currentError: string | null;
      failureCount: number;
      nextEligibleAt: Date | null;
      providerStatus: string;
      downloadState: string;
      projectionState: string;
    }>
  >`
    select artifact.download_state as "downloadState", artifact.projection_state as "projectionState",
      lane.status as "providerStatus", lane.failure_count::int as "failureCount",
      lane.current_error as "currentError", lane.next_eligible_at as "nextEligibleAt"
    from source_artifact artifact cross join source_lane lane where lane.id = 'uspto-odp'
  `;
  expect(state).toEqual({
    currentError: null,
    downloadState: "complete",
    failureCount: 0,
    nextEligibleAt: null,
    projectionState: "pending",
    providerStatus: "ready",
  });
});

test("rolls back artifact success when provider reset cannot commit", async () => {
  await seedArtifact(1, "pending");
  await database`
    insert into source_lane (id, status, failure_count, current_error, next_eligible_at)
    values ('uspto-odp', 'backoff', 7, 'old failure', '2025-01-01T00:00:00Z')
  `;
  await database.unsafe(`
    create function reject_provider_success() returns trigger language plpgsql as $$
    begin
      if old.failure_count > 0 and new.failure_count = 0 then
        raise exception 'injected provider success persistence';
      end if;
      return new;
    end;
    $$;
    create trigger reject_provider_success before update on source_lane
    for each row execute function reject_provider_success();
  `);
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: () =>
        Promise.resolve({
          body: new ReadableStream<Uint8Array>(),
          expectedBytes: 1,
          responseState: { status: 200 },
        }),
    },
  });
  try {
    await expect(module.reconcile()).rejects.toThrow("injected provider success persistence");
  } finally {
    await database`drop trigger if exists reject_provider_success on source_lane`;
    await database`drop function if exists reject_provider_success()`;
  }

  const [state] = await database<
    Array<{
      currentError: string | null;
      failureCount: number;
      objectKey: string | null;
      providerStatus: string;
      downloadState: string;
    }>
  >`
    select artifact.download_state as "downloadState", artifact.object_key as "objectKey",
      lane.status as "providerStatus",
      lane.failure_count::int as "failureCount", lane.current_error as "currentError"
    from source_artifact artifact cross join source_lane lane where lane.id = 'uspto-odp'
  `;
  expect(state).toEqual({
    currentError: "old failure",
    downloadState: "downloading",
    failureCount: 7,
    objectKey: null,
    providerStatus: "backoff",
  });
});

test("commits discovery and provider success as one transaction", async () => {
  await database`
    insert into source_lane (id, status, failure_count, current_error, next_eligible_at)
    values ('uspto-odp', 'backoff', 3, 'old discovery failure', '2025-01-01T00:00:00Z')
  `;
  await database.unsafe(`
    create function reject_discovery_success() returns trigger language plpgsql as $$
    begin
      if old.failure_count > 0 and new.failure_count = 0 then
        raise exception 'injected discovery success persistence';
      end if;
      return new;
    end;
    $$;
    create trigger reject_discovery_success before update on source_lane
    for each row execute function reject_discovery_success();
  `);
  const sourceCatalog = {
    discover: async () => ({
      artifacts: [...annualBaselineV1Artifacts].map((filename) => ({
        bytes: 1,
        downloadUrl: `https://example.test/${filename}`,
        filename,
        fromDate: "1884-04-07",
        lastModifiedAt: "2026-01-01T00:00:00Z",
        releaseDate: "2026-01-01",
        toDate: "2025-12-31",
      })),
      product: {
        frequency: "YEARLY",
        identifier: "TRTYRAP",
        lastModifiedAt: "2026-01-01T00:00:00Z",
        title: "Annual",
      },
      responseState: { status: 200 },
    }),
    download: unavailableSource.download,
  };
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog,
  });
  try {
    await expect(module.reconcile()).rejects.toThrow("injected discovery success persistence");
  } finally {
    await database`drop trigger if exists reject_discovery_success on source_lane`;
    await database`drop function if exists reject_discovery_success()`;
  }
  const [rolledBack] = await database<Array<{ artifacts: number; failureCount: number }>>`
    select (select count(*)::int from source_artifact) artifacts,
      failure_count::int as "failureCount" from source_lane where id = 'uspto-odp'
  `;
  expect(rolledBack).toEqual({ artifacts: 0, failureCount: 3 });

  expect(await module.reconcile()).toMatchObject({ action: "discovered", artifactCount: 91 });
  expect((await module.status()).lane).toMatchObject({ failureCount: 0, status: "ready" });
});

test("a file-specific 429 fails only that artifact and downloads the next one", async () => {
  await seedArtifact(1, "pending");
  await seedArtifact(2, "pending");
  let downloadCount = 0;
  const sourceCatalog = {
    discover: unavailableSource.discover,
    download: (downloadUrl: string) => {
      downloadCount += 1;
      if (downloadUrl.endsWith("annual-01.zip")) {
        return Promise.reject(
          new SourceHttpError(
            "USPTO ODP download redirect failed with HTTP 429",
            {
              rateLimitReset: "3600",
              requestId: "quota-1",
              retryAfter: "600",
              status: 429,
            },
            "download-redirect"
          )
        );
      }
      return Promise.resolve({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
        expectedBytes: 1,
        responseState: { requestId: "download-2", status: 200 },
      });
    },
  };
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog,
  });

  expect(await module.reconcile()).toMatchObject({
    action: "artifact-download-failed",
    filename: "annual-01.zip",
  });
  expect(await module.reconcile()).toMatchObject({
    action: "downloaded",
    filename: "annual-02.zip",
  });
  expect(downloadCount).toBe(2);
  expect((await module.status()).lane).toMatchObject({ failureCount: 0, status: "ready" });
  const artifacts = await database<
    Array<{
      downloadError: string | null;
      downloadResponseState: SourceHttpError["responseState"] | null;
      downloadState: string;
      filename: string;
    }>
  >`
    select filename, download_state as "downloadState", download_error as "downloadError",
      download_response_state as "downloadResponseState"
    from source_artifact order by filename
  `;
  expect([...artifacts]).toEqual([
    {
      downloadError: "USPTO ODP download redirect failed with HTTP 429",
      downloadResponseState: {
        rateLimitReset: "3600",
        requestId: "quota-1",
        retryAfter: "600",
        status: 429,
      },
      downloadState: "failed",
      filename: "annual-01.zip",
    },
    {
      downloadError: null,
      downloadResponseState: { requestId: "download-2", status: 200 },
      downloadState: "complete",
      filename: "annual-02.zip",
    },
  ]);
});

test("a data-origin 429 blocks only that file", async () => {
  await seedArtifact(1, "pending");
  let downloadCount = 0;
  const module = createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml: () => Promise.resolve(Readable.from([])),
    now: () => new Date("2026-07-18T20:00:00Z"),
    retry: { baseMs: 1000, jitter: () => 0, maxMs: 1000 },
    sourceCatalog: {
      discover: unavailableSource.discover,
      download: () => {
        downloadCount += 1;
        return Promise.reject(
          new SourceHttpError(
            "USPTO ODP data download failed with HTTP 429",
            { retryAfter: "60", status: 429 },
            "download-data"
          )
        );
      },
    },
  });

  expect(await module.reconcile()).toMatchObject({ action: "artifact-download-failed" });
  expect(downloadCount).toBe(1);
  expect((await module.status()).lane).toMatchObject({ failureCount: 0, status: "ready" });
  expect([
    ...(await database`
      select download_state, download_error from source_artifact where filename = 'annual-01.zip'
    `),
  ]).toEqual([
    {
      download_error: "USPTO ODP data download failed with HTTP 429",
      download_state: "failed",
    },
  ]);
});
