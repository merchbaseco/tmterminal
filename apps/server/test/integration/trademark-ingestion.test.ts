import { afterAll, beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { annualBaselineV1Artifacts } from "../../src/ingestion/annual-baseline-v1.ts";
import { SourceTransportError } from "../../src/ingestion/source-catalog.ts";
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
  await database`insert into source_artifact (id, product, filename, download_url, expected_bytes, source_from_date, source_to_date, state, sha256, object_key) values (${`71000000-0000-4000-8000-${String(index).padStart(12, "0")}`}, 'TRTYRAP', ${`annual-${String(index).padStart(2, "0")}.zip`}, 'https://example.test/annual.zip', 1, '1884-04-07', '2025-12-31', ${state}, ${sha}, ${objectKey})`;
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
      source_from_date, source_to_date, state, sha256, object_key)
    values (${`72000000-0000-4000-8000-${String(index).padStart(12, "0")}`}, 'TRTDXFAP',
      ${filename}, 'https://example.test/daily.zip', 1, ${sourceDate}, ${sourceDate},
      'projecting', ${sha}, ${`sha256/daily-${index}`})
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
      source_from_date, source_to_date, state)
    values
      ('72000000-0000-4000-8000-000000000016', 'TRTDXFAP', 'apc270716.zip',
        'https://example.test/apc270716.zip', 1, '2027-07-16', '2027-07-16', 'complete'),
      ('72000000-0000-4000-8000-000000000017', 'TRTDXFAP', 'apc270717.zip',
        'https://example.test/apc270717.zip', 1, '2027-07-17', '2027-07-17', 'complete')
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
      source_from_date, source_to_date, state, sha256)
    values ('72000000-0000-4000-8000-000000000001', 'TRTDXFAP', 'apc260101.zip',
      'https://example.test/apc260101.zip', 1, '2026-01-01', '2026-01-01', 'complete', ${sha})
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

test("restart resumes one projecting artifact and removes its ZIP after commit", async () => {
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
    Array<{ objectKey: string | null; state: string }>
  >`select object_key as "objectKey", state from source_artifact`;
  expect(artifact).toEqual({ objectKey: null, state: "complete" });
  expect(await database`select serial_number from mark`).toHaveLength(1);
  expect([...(await database`select international_code from mark_class order by ordinal`)]).toEqual(
    [{ international_code: "025" }]
  );
  expect([...(await database`select word_mark from mark`)]).toEqual([{ word_mark: "GUESS JEANS" }]);
  expect((await ingestion().status()).dataVersion).toBe(1);
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

test("terminal projection failure leaves a clear error and no ZIP", async () => {
  await seedArtifact(1, "projecting", "sha256/object");
  const broken = async () =>
    Readable.from([sourceDocument("<case-file><serial-number>bad</serial-number></case-file>")]);
  expect(await ingestion(broken).reconcile()).toMatchObject({
    action: "artifact-failed",
    reason: expect.stringContaining("serial-number"),
  });
  expect(removed).toEqual(["sha256/object"]);
  const [artifact] = await database<
    Array<{ currentError: string; objectKey: string | null; state: string }>
  >`select current_error as "currentError", object_key as "objectKey", state from source_artifact`;
  expect(artifact).toMatchObject({
    currentError: expect.stringContaining("serial-number"),
    objectKey: null,
    state: "failed",
  });
  expect((await ingestion(broken).status()).failedArtifactUpdatedAt).toBeInstanceOf(Date);
});

test("restart fails an interrupted download without fetching it again", async () => {
  await seedArtifact(1, "downloading");
  await seedArtifact(2, "pending");
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
    action: "artifact-failed",
    reason: "Download interrupted before retention",
  });
  expect(await restartedIngestion().reconcile()).toMatchObject({
    action: "artifact-failed",
    reason: "Download interrupted before retention",
  });
  expect(downloadCount).toBe(0);
  const artifacts = await database<
    Array<{ currentError: string | null; objectKey: string | null; state: string }>
  >`select current_error as "currentError", object_key as "objectKey", state from source_artifact order by filename`;
  expect([...artifacts]).toEqual([
    {
      currentError: "Download interrupted before retention",
      objectKey: null,
      state: "failed",
    },
    { currentError: null, objectKey: null, state: "pending" },
  ]);
});

test("rolls back artifact retry state when durable failure accounting cannot commit", async () => {
  await seedArtifact(1, "pending");
  let downloadCount = 0;
  const sourceCatalog = {
    discover: unavailableSource.discover,
    download: () => {
      downloadCount += 1;
      return Promise.reject(new SourceTransportError("interrupted"));
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
  await database.unsafe(`
    create function reject_provider_failure() returns trigger language plpgsql as $$
    begin
      if new.failure_count > 0 then
        raise exception 'injected provider failure persistence';
      end if;
      return new;
    end;
    $$;
    create trigger reject_provider_failure before insert or update on source_lane
    for each row execute function reject_provider_failure();
  `);
  try {
    await expect(restartedIngestion().reconcile()).rejects.toThrow(
      "injected provider failure persistence"
    );
  } finally {
    await database`drop trigger if exists reject_provider_failure on source_lane`;
    await database`drop function if exists reject_provider_failure()`;
  }

  const [interrupted] = await database<Array<{ failureCount: number; state: string }>>`
    select artifact.state, lane.failure_count::int as "failureCount"
    from source_artifact artifact cross join source_lane lane
    where lane.id = 'uspto-odp'
  `;
  expect(interrupted).toEqual({ failureCount: 0, state: "downloading" });
  expect(await restartedIngestion().reconcile()).toMatchObject({
    action: "artifact-failed",
    reason: "Download interrupted before retention",
  });
  expect(downloadCount).toBe(1);
});

test("stops after one download when response length changes catalog identity", async () => {
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

  expect(await module.reconcile()).toEqual({ action: "provider-stopped" });
  expect(await module.reconcile()).toEqual({ action: "provider-stopped" });
  expect(downloadCount).toBe(1);
  expect((await module.status()).lane).toMatchObject({
    currentError: "Source artifact response length changed from its catalog value",
    failureCount: 1,
    status: "stopped",
  });
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
      state: string;
    }>
  >`
    select artifact.state, lane.status as "providerStatus", lane.failure_count::int as "failureCount",
      lane.current_error as "currentError", lane.next_eligible_at as "nextEligibleAt"
    from source_artifact artifact cross join source_lane lane where lane.id = 'uspto-odp'
  `;
  expect(state).toEqual({
    currentError: null,
    failureCount: 0,
    nextEligibleAt: null,
    providerStatus: "ready",
    state: "projecting",
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
      state: string;
    }>
  >`
    select artifact.state, artifact.object_key as "objectKey", lane.status as "providerStatus",
      lane.failure_count::int as "failureCount", lane.current_error as "currentError"
    from source_artifact artifact cross join source_lane lane where lane.id = 'uspto-odp'
  `;
  expect(state).toEqual({
    currentError: "old failure",
    failureCount: 7,
    objectKey: null,
    providerStatus: "backoff",
    state: "downloading",
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

test("stops the same artifact after eight durable download attempts", async () => {
  await seedArtifact(1, "pending");
  let downloadCount = 0;
  let currentTime = new Date("2026-01-01T00:00:00Z");
  const sourceCatalog = {
    discover: unavailableSource.discover,
    download: () => {
      downloadCount += 1;
      return Promise.reject(new SourceTransportError("interrupted"));
    },
  };
  const restartedIngestion = () =>
    createTrademarkIngestion({
      artifactStore: store,
      database,
      extractXml: () => Promise.resolve(Readable.from([])),
      now: () => currentTime,
      retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
      sourceCatalog,
    });

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Persisted retry state must advance sequentially across simulated restarts.
    expect(await restartedIngestion().reconcile()).toEqual({
      action: attempt === 8 ? "provider-stopped" : "provider-backoff",
    });
    currentTime = new Date(currentTime.getTime() + 10_000);
  }
  expect(downloadCount).toBe(8);
  expect((await restartedIngestion().status()).lane).toMatchObject({
    failureCount: 8,
    status: "stopped",
  });
  expect(await restartedIngestion().reconcile()).toEqual({ action: "provider-stopped" });
  expect(downloadCount).toBe(8);
});
