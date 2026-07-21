import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import type { ArtifactStore } from "../../src/ingestion/artifact-store.ts";
import type {
  DiscoveredArtifact,
  DiscoveredProduct,
  SourceCatalog,
} from "../../src/ingestion/source-catalog.ts";
import { SourceContractError, SourceHttpError } from "../../src/ingestion/source-catalog.ts";
import {
  importSourceArtifact,
  inspectSourceArtifact,
  repairSourceArtifact,
} from "../../src/ingestion/source-repair.ts";
import { applyTrademarkBatch } from "../../src/ingestion/trademark-application.ts";
import {
  createTrademarkIngestion,
  readTrademarkIngestionStatus,
} from "../../src/ingestion/trademark-ingestion.ts";
import type { TrademarkProjection } from "../../src/ingestion/trademark-projection.ts";
import { readDataSnapshot } from "../../src/queries/data-snapshot.ts";
import {
  readOperatorAttentionArtifacts,
  readOperatorProcessingActivity,
  readOperatorSourceSummary,
} from "../../src/queries/operator-sync-repository.ts";
import { createMarksService } from "../../src/services/marks-service.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}
const database = postgres(databaseUrl, { max: 3, prepare: false });
const sha = "a".repeat(64);
const annualFilename = "apc18840407-20251231-01.zip";
const dailyFilename = "apc260101.zip";
const removed: string[] = [];
const retained = new Set<string>();
const documents = new Map<string, string>();
const reserved = new Map<string, { bytes: number; objectKey: string; sha256: string }>();
let downloaded: string[] = [];
let now = new Date("2026-01-03T12:00:00Z");

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
    removed.push(objectKey);
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
  downloaded = [];
  removed.length = 0;
  retained.clear();
  reserved.clear();
  documents.clear();
  now = new Date("2026-01-03T12:00:00Z");
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterAll(() => database.end({ timeout: 1 }));

test("an empty live database remains searchable", async () => {
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
    meta: { dataVersion: "0" },
    offset: 0,
    total: 0,
  });
  expect(await marks.getBySerialNumber("99999999")).toBeNull();
});

test("discovers provider packaging into one oldest-first source inventory", async () => {
  const module = ingestion(catalog());

  expect(await module.reconcile()).toEqual({ action: "discovered", artifactCount: 3 });
  expect([
    ...(await database<
      Array<{ disposition: string; filename: string; fromDate: string; toDate: string }>
    >`
      select filename, processing_disposition as disposition,
        source_from_date::text as "fromDate", source_to_date::text as "toDate"
      from source_artifact order by source_to_date, source_from_date, filename
    `),
  ]).toEqual([
    {
      disposition: "required",
      filename: annualFilename,
      fromDate: "1884-04-07",
      toDate: "2025-12-31",
    },
    {
      disposition: "deferred",
      filename: "apc251231.zip",
      fromDate: "2025-12-31",
      toDate: "2025-12-31",
    },
    {
      disposition: "required",
      filename: dailyFilename,
      fromDate: "2026-01-01",
      toDate: "2026-01-01",
    },
  ]);
  expect((await module.status()).pendingArtifactCount).toBe(2);
});

test("an upgraded broad inventory covers newly discovered historical files", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state, sha256
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTYRAP', ${annualFilename},
      ${Buffer.byteLength(annualFilename)}, '1884-04-07', '2025-12-31',
      'downloaded', 'complete', ${sha}
    )
  `;

  expect(await ingestion(catalog()).reconcile()).toEqual({
    action: "discovered",
    artifactCount: 2,
  });
  expect([
    ...(await database`
      select filename, processing_disposition from source_artifact
      where product = 'TRTDXFAP' order by filename
    `),
  ]).toEqual([
    { filename: "apc251231.zip", processing_disposition: "covered" },
    { filename: dailyFilename, processing_disposition: "required" },
  ]);
  expect((await readTrademarkIngestionStatus(database)).attentionCount).toBe(0);
});

test("a new broad member reopens its covered fallback until the group completes", async () => {
  const broadFromDate = "1884-04-07";
  const broadToDate = "2025-12-31";
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state, sha256, processing_disposition, selected_broad_from_date,
      selected_broad_to_date
    ) values
      ('71000000-0000-4000-8000-000000000001', 'TRTYRAP', 'broad-01.zip',
        ${Buffer.byteLength("broad-01.zip")}, ${broadFromDate}, ${broadToDate},
        'downloaded', 'complete', ${sha}, 'required', null, null),
      ('71000000-0000-4000-8000-000000000002', 'TRTDXFAP', 'fallback.zip',
        ${Buffer.byteLength("fallback.zip")}, '2025-07-01', '2025-07-01',
        'blocked', 'pending', null, 'covered', ${broadFromDate}, ${broadToDate})
  `;
  const module = ingestion(
    catalog({
      discover: async (product) =>
        product === "TRTYRAP"
          ? discovered("TRTYRAP", "YEARLY", [
              {
                ...artifact("broad-01.zip", broadFromDate, broadToDate),
                downloadUrl:
                  "https://api.uspto.gov/api/v1/datasets/products/files/TRTYRAP/broad-01.zip",
              },
              {
                ...artifact("broad-02.zip", broadFromDate, broadToDate),
                downloadUrl:
                  "https://api.uspto.gov/api/v1/datasets/products/files/TRTYRAP/broad-02.zip",
              },
            ])
          : discovered("TRTDXFAP", "DAILY", [artifact("fallback.zip", "2025-07-01", "2025-07-01")]),
    })
  );

  expect(await module.reconcile()).toEqual({ action: "discovered", artifactCount: 1 });
  expect([
    ...(await database`
      select filename, processing_disposition from source_artifact order by filename
    `),
  ]).toEqual([
    { filename: "broad-01.zip", processing_disposition: "required" },
    { filename: "broad-02.zip", processing_disposition: "required" },
    { filename: "fallback.zip", processing_disposition: "deferred" },
  ]);
  expect((await module.status()).attentionCount).toBe(0);
  expect((await readOperatorSourceSummary(database)).attentionCount).toBe(0);
  expect(await readOperatorAttentionArtifacts(database, 10)).toHaveLength(0);
});

test("keeps durable source rows after they roll out of the provider catalog", async () => {
  let dailyArtifacts = [
    artifact("apc251231.zip", "2025-12-31", "2025-12-31"),
    artifact(dailyFilename, "2026-01-01", "2026-01-01"),
  ];
  const module = ingestion(
    catalog({
      discover: async (product) =>
        product === "TRTYRAP"
          ? discovered("TRTYRAP", "YEARLY", [artifact(annualFilename, "1884-04-07", "2025-12-31")])
          : discovered("TRTDXFAP", "DAILY", dailyArtifacts),
    })
  );

  expect(await module.reconcile()).toMatchObject({ action: "discovered", artifactCount: 3 });
  dailyArtifacts = [artifact(dailyFilename, "2026-01-01", "2026-01-01")];
  now = new Date("2026-01-04T12:00:01Z");
  expect(await module.reconcile()).toMatchObject({ action: "discovered", artifactCount: 0 });
  expect([
    ...(await database`select filename from source_artifact order by filename`),
  ]).toHaveLength(3);
});

test("retains a growing cumulative catalog in bounded insert statements", async () => {
  await database`
    create function reject_large_source_inserts() returns trigger language plpgsql as $$
    begin
      if (select count(*) from inserted) > 250 then
        raise exception 'source artifact insert exceeded 250 rows';
      end if;
      return null;
    end $$
  `;
  await database`
    create trigger source_artifact_insert_bound after insert on source_artifact
    referencing new table as inserted for each statement execute function reject_large_source_inserts()
  `;
  const dailyArtifacts = Array.from({ length: 501 }, (_, index) => {
    const day = String(index + 1).padStart(3, "0");
    return artifact(`apc26${day}.zip`, "2026-01-01", "2026-01-01");
  });
  const module = ingestion(
    catalog({
      discover: async (product) =>
        product === "TRTYRAP"
          ? discovered("TRTYRAP", "YEARLY", [artifact(annualFilename, "1884-04-07", "2025-12-31")])
          : discovered("TRTDXFAP", "DAILY", dailyArtifacts),
    })
  );

  expect(await module.reconcile()).toEqual({ action: "discovered", artifactCount: 502 });
  expect([...(await database`select id from source_artifact`)]).toHaveLength(502);
  now = new Date("2026-01-04T12:00:01Z");
  expect(await module.reconcile()).toEqual({ action: "discovered", artifactCount: 0 });
});

test("downloads once, validates, applies in bounded transactions, and removes the ZIP", async () => {
  const module = ingestion(catalog());
  expect((await module.reconcile()).action).toBe("discovered");
  expect(await module.reconcile()).toMatchObject({
    action: "artifact-downloaded",
    filename: annualFilename,
  });
  expect(downloaded).toEqual([annualFilename]);
  expect(retained.size).toBe(1);
  expect([...retained][0]).toStartWith("source/");

  expect(await module.reconcile()).toMatchObject({
    action: "artifact-applied",
    appliedRecordCount: 1,
    filename: annualFilename,
    physicalRecordCount: 1,
    projectedMarkCount: 1,
    unresolvedRecordCount: 0,
  });
  expect(removed).toHaveLength(1);
  expect(removed[0]).toStartWith("source/");
  expect(retained.size).toBe(0);
  expect([
    ...(await database`
      select download_request_count, download_state, application_state, object_key,
        applied_record_count, unresolved_record_count
      from source_artifact where filename = ${annualFilename}
    `),
  ]).toEqual([
    {
      application_state: "complete",
      applied_record_count: 1,
      download_request_count: 1,
      download_state: "downloaded",
      object_key: null,
      unresolved_record_count: 0,
    },
  ]);
  expect(await createMarksService(database).getBySerialNumber("74668071")).toMatchObject({
    mark: { wordMark: "ANNUAL SHIRT" },
    provenance: { versions: { projection: "uspto-projection-v2" } },
    type: "typeset",
  });
});

test("a completed file remains applied when ZIP cleanup needs another attempt", async () => {
  let cleanupAttempts = 0;
  const cleanupStore: ArtifactStore = {
    ...artifactStore,
    remove: (objectKey) => {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) {
        return Promise.reject(new Error("temporary cleanup failure"));
      }
      return artifactStore.remove(objectKey);
    },
  };
  const module = ingestion(catalog(), undefined, cleanupStore);
  await module.reconcile();
  await module.reconcile();

  await expect(module.reconcile()).resolves.toMatchObject({ action: "artifact-applied" });
  expect((await module.status()).worker.currentError).toBeNull();
  expect([
    ...(await database`
      select application_state, object_key from source_artifact where filename = ${annualFilename}
    `),
  ]).toEqual([{ application_state: "complete", object_key: expect.any(String) }]);
  await expect(module.reconcile()).resolves.toMatchObject({ action: "cleanup-artifact" });
  expect([
    ...(await database`
      select application_state, object_key from source_artifact where filename = ${annualFilename}
    `),
  ]).toEqual([{ application_state: "complete", object_key: null }]);
});

test("a blocked download is one request and does not stop newer files", async () => {
  const module = ingestion(
    catalog({
      download: ({ filename }) => {
        downloaded.push(filename);
        if (filename === annualFilename) {
          throw new SourceContractError("USPTO rejected this file request");
        }
        return Promise.resolve(download(filename));
      },
    })
  );
  await module.reconcile();
  expect(await module.reconcile()).toMatchObject({
    action: "artifact-download-blocked",
    filename: annualFilename,
  });
  expect(await module.reconcile()).toMatchObject({
    action: "artifact-downloaded",
    filename: dailyFilename,
  });
  expect(downloaded).toEqual([annualFilename, dailyFilename]);
  expect([
    ...(await database`
      select filename, download_request_count, download_state from source_artifact
      where filename in (${annualFilename}, ${dailyFilename}) order by filename
    `),
  ]).toEqual([
    { download_request_count: 1, download_state: "blocked", filename: annualFilename },
    { download_request_count: 1, download_state: "downloaded", filename: dailyFilename },
  ]);
});

test("a provider header cooldown is retained for a later repair", async () => {
  const module = ingestion(
    catalog({
      download: () => {
        throw new SourceHttpError(
          "USPTO rate limited this file",
          { retryAfter: "60", status: 429 },
          "download-data"
        );
      },
    })
  );
  await module.reconcile();
  expect(await module.reconcile()).toMatchObject({ action: "artifact-download-blocked" });

  expect([
    ...(await database`
      select download_response_state from source_artifact where filename = ${annualFilename}
    `),
  ]).toEqual([
    {
      download_response_state: {
        observedAt: now.toISOString(),
        retryAfter: "60",
        retryNotBefore: new Date(now.getTime() + 60_000).toISOString(),
        status: 429,
      },
    },
  ]);
});

test("an artifact-store failure stops ingestion before another provider request", async () => {
  const unavailableStore: ArtifactStore = {
    ...artifactStore,
    put: () => Promise.reject(new Error("artifact disk is full")),
  };
  const module = ingestion(catalog(), undefined, unavailableStore);

  await module.reconcile();
  await expect(module.reconcile()).rejects.toThrow("artifact disk is full");
  expect(downloaded).toEqual([annualFilename]);
  expect((await module.status()).worker.currentError).toBe("artifact disk is full");
  await expect(module.reconcile()).resolves.toEqual({ action: "stopped" });
  expect(downloaded).toEqual([annualFilename]);
});

test("restart blocks an interrupted download without another provider request", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state
    ) values
      ('71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename},
        ${Buffer.byteLength(dailyFilename)}, '2026-01-01', '2026-01-01', 'downloading',
        'pending'),
      ('71000000-0000-4000-8000-000000000002', 'TRTYRAP', 'broad.zip', 1,
        '1884-04-07', '2025-12-31', 'downloaded', 'complete')
  `;
  const module = ingestion(catalog());

  expect(await module.reconcile()).toMatchObject({
    action: "artifact-download-blocked",
    filename: dailyFilename,
  });
  expect(downloaded).toEqual([]);
  expect([
    ...(await database`
      select download_state, processing_disposition from source_artifact
      where filename = ${dailyFilename}
    `),
  ]).toEqual([{ download_state: "blocked", processing_disposition: "required" }]);
  expect(await module.reconcile()).toMatchObject({ action: "discovered" });
  expect(downloaded).toEqual([]);
});

test("restart covers an interrupted download when a broad source already replaced it", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state
    ) values
      ('71000000-0000-4000-8000-000000000001', 'TRTDXFAP', 'apc250701.zip', 1,
        '2025-07-01', '2025-07-01', 'downloading', 'pending'),
      ('71000000-0000-4000-8000-000000000002', 'TRTYRAP', 'broad.zip', 1,
        '1884-04-07', '2025-12-31', 'downloaded', 'complete')
  `;

  expect(await ingestion(catalog()).reconcile()).toMatchObject({
    action: "artifact-download-blocked",
    filename: "apc250701.zip",
  });
  expect([
    ...(await database`
      select download_state, processing_disposition from source_artifact
      where filename = 'apc250701.zip'
    `),
  ]).toEqual([{ download_state: "blocked", processing_disposition: "covered" }]);
  expect((await readTrademarkIngestionStatus(database)).attentionCount).toBe(0);
});

test("restart adopts a completed reserved download without another provider request", async () => {
  const artifactId = "71000000-0000-4000-8000-000000000001";
  const bytes = Buffer.from(dailyFilename);
  const stored = {
    bytes: bytes.length,
    objectKey: `source/${artifactId}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  reserved.set(artifactId, stored);
  retained.add(stored.objectKey);
  documents.set(stored.objectKey, sourceDocument(recordFor(dailyFilename)));
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state
    ) values (
      ${artifactId}, 'TRTDXFAP', ${dailyFilename}, ${bytes.length},
      '2026-01-01', '2026-01-01', 'downloading'
    )
  `;

  expect(await ingestion(catalog()).reconcile()).toMatchObject({
    action: "artifact-downloaded",
    artifactId,
    filename: dailyFilename,
    sha256: stored.sha256,
  });
  expect(downloaded).toEqual([]);
  expect([
    ...(await database`
      select download_state, object_key from source_artifact where id = ${artifactId}
    `),
  ]).toEqual([{ download_state: "downloaded", object_key: stored.objectKey }]);
});

test("a source error retains verified bytes for a parser repair", async () => {
  const module = ingestion(catalog(), () =>
    Promise.resolve(Readable.from(["<not-the-uspto-document />"]))
  );
  await module.reconcile();
  await module.reconcile();
  expect(await module.reconcile()).toMatchObject({
    action: "artifact-needs-attention",
    filename: annualFilename,
  });
  expect(retained.size).toBe(1);
  expect([...retained][0]).toStartWith("source/");
  const [failedArtifact] = await database<
    Array<{ application_state: string; download_state: string; object_key: string }>
  >`
    select application_state, download_state, object_key from source_artifact
    where filename = ${annualFilename}
  `;
  expect(failedArtifact).toMatchObject({
    application_state: "needs_attention",
    download_state: "downloaded",
  });
  expect(failedArtifact?.object_key).toStartWith("source/");
  expect(await module.reconcile()).toMatchObject({ action: "artifact-downloaded" });
  expect(downloaded).toEqual([annualFilename, dailyFilename]);
});

test("a system extraction failure stops the worker without blaming the source file", async () => {
  const module = ingestion(catalog(), () => Promise.reject(new Error("artifact storage denied")));
  await module.reconcile();
  await module.reconcile();

  await expect(module.reconcile()).rejects.toThrow("artifact storage denied");
  expect([
    ...(await database`
      select application_state, current_error from source_artifact where filename = ${annualFilename}
    `),
  ]).toEqual([{ application_state: "applying", current_error: null }]);
  expect([
    ...(await database`select activity, current_error from worker_status where id = 'uspto'`),
  ]).toEqual([{ activity: "idle", current_error: "artifact storage denied" }]);
});

test("manual import records its acquisition and queues retained bytes without an API call", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      current_error, download_request_count
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename},
      ${Buffer.byteLength(dailyFilename)}, '2026-01-01', '2026-01-01', 'blocked',
      'rate limited', 1
    )
  `;

  const result = await importSourceArtifact(artifactStore, database, {
    body: new Blob([dailyFilename]).stream(),
    filename: dailyFilename,
    product: "TRTDXFAP",
  });

  expect(result).toMatchObject({
    applicationState: "pending",
    downloadRequestCount: 2,
    downloadState: "downloaded",
    hasRetainedZip: true,
  });
  expect(downloaded).toEqual([]);
});

test("source inspection includes current worker failure context", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename}, 1,
      '2026-01-01', '2026-01-01'
    )
  `;
  await database`
    update worker_status set activity = 'idle', current_error = 'Artifact storage is unavailable',
      current_filename = ${dailyFilename}, last_heartbeat_at = ${now}
    where id = 'uspto'
  `;

  const inspected = await inspectSourceArtifact(artifactStore, database, {
    filename: dailyFilename,
    product: "TRTDXFAP",
  });

  expect(inspected.worker).toEqual({
    activity: "idle",
    currentError: "Artifact storage is unavailable",
    currentFilename: dailyFilename,
    lastHeartbeatAt: now,
  });
});

test("reacquisition respects a recorded provider cooldown", async () => {
  const retryNotBefore = "2099-07-25T12:00:00.000Z";
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      current_error, download_request_count, download_response_state
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename}, 1,
      '2026-01-01', '2026-01-01', 'blocked', 'rate limited', 1,
      ${database.json({ retryNotBefore })}
    )
  `;

  await expect(
    repairSourceArtifact(artifactStore, database, {
      action: "reacquire",
      filename: dailyFilename,
      product: "TRTDXFAP",
    })
  ).rejects.toThrow(`Reacquisition is blocked until ${retryNotBefore}`);
  expect([
    ...(await database`
      select download_state, download_request_count from source_artifact where filename = ${dailyFilename}
    `),
  ]).toEqual([{ download_request_count: 1, download_state: "blocked" }]);
});

test("reacquisition rejects an unstructured provider throttle", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      current_error, download_request_count, download_response_state
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename}, 1,
      '2026-01-01', '2026-01-01', 'blocked', 'rate limited', 1,
      ${database.json({ status: 429 })}
    )
  `;

  await expect(
    repairSourceArtifact(artifactStore, database, {
      action: "reacquire",
      filename: dailyFilename,
      product: "TRTDXFAP",
    })
  ).rejects.toThrow("Reacquisition requires a known USPTO retry time");
  expect([
    ...(await database`
      select download_state, download_request_count from source_artifact where filename = ${dailyFilename}
    `),
  ]).toEqual([{ download_request_count: 1, download_state: "blocked" }]);
});

test("repair requests reject a covered source file", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      processing_disposition
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename}, 1,
      '2026-01-01', '2026-01-01', 'blocked', 'covered'
    )
  `;

  await expect(
    repairSourceArtifact(artifactStore, database, {
      action: "reacquire",
      filename: dailyFilename,
      product: "TRTDXFAP",
    })
  ).rejects.toThrow("Reacquisition requires a required source file, not covered");
  await expect(
    importSourceArtifact(artifactStore, database, {
      body: new Blob([dailyFilename]).stream(),
      filename: dailyFilename,
      product: "TRTDXFAP",
    })
  ).rejects.toThrow("Import requires a required source file, not covered");
  expect([
    ...(await database`
      select download_state, processing_disposition from source_artifact
      where filename = ${dailyFilename}
    `),
  ]).toEqual([{ download_state: "blocked", processing_disposition: "covered" }]);
});

test("parser replay requeues only verified retained bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tmturtle-replay-"));
  const path = join(directory, "retained.zip");
  const bytes = Buffer.from("retained-source");
  await writeFile(path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state, current_error, bytes, sha256, object_key
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename}, ${bytes.length},
      '2026-01-01', '2026-01-01', 'downloaded', 'needs_attention', 'parser issue',
      ${bytes.length}, ${digest}, 'sha256/retained'
    )
  `;
  const replayStore: ArtifactStore = {
    ...artifactStore,
    openFile: async () => path,
  };

  try {
    const result = await repairSourceArtifact(replayStore, database, {
      action: "replay",
      filename: dailyFilename,
      product: "TRTDXFAP",
    });
    expect(result).toMatchObject({
      applicationState: "pending",
      currentError: null,
      downloadRequestCount: 0,
      downloadState: "downloaded",
      hasRetainedZip: true,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a parser version change does not replay retained files without repair", async () => {
  retained.add("sha256/retained");
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state, current_error, bytes, sha256, object_key, parser_version
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename}, 1,
      '2026-01-01', '2026-01-01', 'downloaded', 'needs_attention', 'parser issue',
      1, ${sha}, 'sha256/retained', 'uspto-projection-v1'
    )
  `;
  await database`
    update worker_status set last_discovery_at = ${now}, last_heartbeat_at = ${now}
    where id = 'uspto'
  `;

  expect(await ingestion(catalog()).reconcile()).toEqual({ action: "idle" });
  expect([
    ...(await database`
      select application_state, parser_version from source_artifact where filename = ${dailyFilename}
    `),
  ]).toEqual([{ application_state: "needs_attention", parser_version: "uspto-projection-v1" }]);
});

test("a worker pulse preserves active ingestion context", async () => {
  await database`
    update worker_status set activity = 'applying', current_filename = ${annualFilename},
      last_heartbeat_at = '2025-01-01T00:00:00Z' where id = 'uspto'
  `;

  await ingestion(catalog()).pulse();

  expect([
    ...(await database`
      select activity, current_filename, last_heartbeat_at from worker_status where id = 'uspto'
    `),
  ]).toEqual([
    {
      activity: "applying",
      current_filename: annualFilename,
      last_heartbeat_at: now,
    },
  ]);
});

test("an operator can promote one deferred bootstrap fallback", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date,
      processing_disposition
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename},
      ${Buffer.byteLength(dailyFilename)}, '2026-01-01', '2026-01-01', 'deferred'
    )
  `;

  const result = await repairSourceArtifact(artifactStore, database, {
    action: "promote",
    filename: dailyFilename,
    product: "TRTDXFAP",
  });

  expect(result.processingDisposition).toBe("required");
  await database`
    update worker_status set last_discovery_at = ${now}, last_heartbeat_at = ${now}
    where id = 'uspto'
  `;
  expect(await ingestion(catalog()).reconcile()).toMatchObject({
    action: "artifact-downloaded",
    filename: dailyFilename,
  });
});

test("an operator can promote a blocked deferred fallback before explicit reacquisition", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date,
      download_state, processing_disposition
    ) values (
      '71000000-0000-4000-8000-000000000001', 'TRTDXFAP', ${dailyFilename},
      ${Buffer.byteLength(dailyFilename)}, '2026-01-01', '2026-01-01', 'blocked', 'deferred'
    )
  `;

  const promoted = await repairSourceArtifact(artifactStore, database, {
    action: "promote",
    filename: dailyFilename,
    product: "TRTDXFAP",
  });
  expect(promoted).toMatchObject({
    downloadState: "blocked",
    processingDisposition: "required",
  });

  const reacquired = await repairSourceArtifact(artifactStore, database, {
    action: "reacquire",
    filename: dailyFilename,
    product: "TRTDXFAP",
  });
  expect(reacquired.downloadState).toBe("pending");
});

test("newer trademark knowledge wins and an equal-date conflict is explicit", async () => {
  const older = projection({ sourceTransactionDate: "2026-01-01", wordMark: "OLDER" });
  const newer = projection({ sourceTransactionDate: "2026-01-02", wordMark: "NEWER" });
  const stale = projection({ sourceTransactionDate: "2025-12-31", wordMark: "STALE" });
  const conflict = projection({
    filename: "other.zip",
    snapshotHash: "b".repeat(64),
    sourceTransactionDate: "2026-01-02",
    wordMark: "CONFLICT",
  });

  for (const item of [older, newer, stale]) {
    // biome-ignore lint/performance/noAwaitInLoops: Precedence is intentionally asserted in order.
    await database.begin((transaction) => applyTrademarkBatch(transaction, [item], now));
  }
  const conflictResult = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [conflict], now)
  );

  expect(conflictResult).toMatchObject({
    appliedRecordCount: 0,
    unresolvedRecordCount: 1,
  });
  expect([
    ...(await database`select word_mark from mark where serial_number = '74668071'`),
  ]).toEqual([{ word_mark: "NEWER" }]);
  expect([
    ...(await database`
      select source_transaction_date::text as date from trademark_recency
      where serial_number = '74668071'
    `),
  ]).toEqual([{ date: "2026-01-02" }]);
});

test("repeated serials in one source batch collapse to the newest safe record", async () => {
  const older = projection({ sourceTransactionDate: "2026-01-01", wordMark: "OLDER" });
  const newer = projection({ sourceTransactionDate: "2026-01-02", wordMark: "NEWER" });

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [older, newer], now)
  );

  expect(result).toMatchObject({ appliedRecordCount: 2, unresolvedRecordCount: 0 });
  expect([
    ...(await database`
      select word_mark, source_transaction_date::text as date from mark
      where serial_number = ${older.serialNumber}
    `),
  ]).toEqual([{ date: "2026-01-02", word_mark: "NEWER" }]);
});

test("a later equal-date record in one source file replaces the earlier occurrence", async () => {
  const first = projection({ sourceTransactionDate: "2026-01-01", wordMark: "FIRST" });
  const later = projection({
    physicalRecordIndex: 2,
    sourceTransactionDate: "2026-01-01",
    wordMark: "LATER",
  });

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [first, later], now)
  );

  expect(result).toMatchObject({ appliedRecordCount: 2, unresolvedRecordCount: 0 });
  expect([
    ...(await database`
      select word_mark, source_physical_record_index as index from mark
      where serial_number = ${first.serialNumber}
    `),
  ]).toEqual([{ index: 2, word_mark: "LATER" }]);
});

test("an identical later record in one source file retains the later coordinate", async () => {
  const first = projection({ sourceTransactionDate: "2026-01-01", wordMark: "SAME" });
  const later = projection({
    physicalRecordIndex: 2,
    sourceTransactionDate: "2026-01-01",
    wordMark: "SAME",
  });

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [first, later], now)
  );

  expect(result).toMatchObject({ appliedRecordCount: 2, unresolvedRecordCount: 0 });
  expect([
    ...(await database`
      select mark.source_physical_record_index as mark_index,
        recency.source_physical_record_index as recency_index
      from mark join trademark_recency recency using (serial_number)
      where mark.serial_number = ${first.serialNumber}
    `),
  ]).toEqual([{ mark_index: 2, recency_index: 2 }]);
});

test("a later observation in one batch preserves the latest tracked snapshot", async () => {
  const tracked = projection({ sourceTransactionDate: "2026-01-01", wordMark: "TRACKED" });
  const observed: TrademarkProjection = {
    coordinate: { ...tracked.coordinate, physicalRecordIndex: 2 },
    kind: "observe",
    serialNumber: tracked.serialNumber,
    snapshotHash: "c".repeat(64),
    sourceTransactionDate: "2026-01-02",
  };

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [tracked, observed], now)
  );

  expect(result).toMatchObject({ appliedRecordCount: 2, unresolvedRecordCount: 0 });
  expect([
    ...(await database`
      select mark.word_mark, recency.source_transaction_date::text as date
      from mark join trademark_recency recency using (serial_number)
      where mark.serial_number = ${tracked.serialNumber}
    `),
  ]).toEqual([{ date: "2026-01-02", word_mark: "TRACKED" }]);
});

test("older tracked evidence materializes beneath a newer untracked observation", async () => {
  const tracked = projection({ sourceTransactionDate: "2026-01-01", wordMark: "TRACKED" });
  const observed: TrademarkProjection = {
    coordinate: { ...tracked.coordinate, filename: "newer.zip", physicalRecordIndex: 2 },
    kind: "observe",
    serialNumber: tracked.serialNumber,
    snapshotHash: "d".repeat(64),
    sourceTransactionDate: "2026-01-02",
  };

  await database.begin((transaction) => applyTrademarkBatch(transaction, [observed], now));
  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [tracked], now)
  );

  expect(result).toMatchObject({ materialChangeCount: 1, unresolvedRecordCount: 0 });
  expect([
    ...(await database`
      select mark.word_mark, mark.source_transaction_date::text as "markDate",
        recency.source_transaction_date::text as "recencyDate"
      from mark join trademark_recency recency using (serial_number)
      where mark.serial_number = ${tracked.serialNumber}
    `),
  ]).toEqual([{ markDate: "2026-01-01", recencyDate: "2026-01-02", word_mark: "TRACKED" }]);
});

test("delayed tracked evidence refreshes an older mark beneath newer recency", async () => {
  const oldest = projection({ sourceTransactionDate: "2026-01-01", wordMark: "OLDEST" });
  const delayed = projection({ sourceTransactionDate: "2026-01-02", wordMark: "DELAYED" });
  const observed: TrademarkProjection = {
    coordinate: { ...oldest.coordinate, filename: "newer.zip", physicalRecordIndex: 3 },
    kind: "observe",
    serialNumber: oldest.serialNumber,
    snapshotHash: "d".repeat(64),
    sourceTransactionDate: "2026-01-03",
  };

  await database.begin((transaction) => applyTrademarkBatch(transaction, [oldest], now));
  await database.begin((transaction) => applyTrademarkBatch(transaction, [observed], now));
  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [delayed], now)
  );

  expect(result).toMatchObject({ materialChangeCount: 1, unresolvedRecordCount: 0 });
  expect([
    ...(await database`
      select mark.word_mark, mark.source_transaction_date::text as "markDate",
        recency.source_transaction_date::text as "recencyDate"
      from mark join trademark_recency recency using (serial_number)
      where mark.serial_number = ${oldest.serialNumber}
    `),
  ]).toEqual([{ markDate: "2026-01-02", recencyDate: "2026-01-03", word_mark: "DELAYED" }]);
});

test("a conflicted projection never materializes after later batch recency advances", async () => {
  const current: TrademarkProjection = {
    coordinate: projection({ sourceTransactionDate: "2026-01-02", wordMark: "CURRENT" }).coordinate,
    kind: "observe",
    serialNumber: "74668071",
    snapshotHash: "a".repeat(64),
    sourceTransactionDate: "2026-01-02",
  };
  const conflict = projection({
    filename: "conflict.zip",
    snapshotHash: "b".repeat(64),
    sourceTransactionDate: "2026-01-02",
    wordMark: "CONFLICT",
  });
  const later: TrademarkProjection = {
    coordinate: { ...current.coordinate, filename: "later.zip", physicalRecordIndex: 3 },
    kind: "observe",
    serialNumber: current.serialNumber,
    snapshotHash: "c".repeat(64),
    sourceTransactionDate: "2026-01-03",
  };

  await database.begin((transaction) => applyTrademarkBatch(transaction, [current], now));
  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [conflict, later], now)
  );

  expect(result).toMatchObject({ materialChangeCount: 0, unresolvedRecordCount: 1 });
  expect([
    ...(await database`select serial_number from mark where serial_number = ${current.serialNumber}`),
  ]).toEqual([]);
});

test("an older source correction updates its retained mark without rolling back newer knowledge", async () => {
  const retainedMark = projection({ sourceTransactionDate: "2026-01-01", wordMark: "RETAINED" });
  const removedMark = projection({ sourceTransactionDate: "2026-01-01", wordMark: "REMOVE ME" });
  if (retainedMark.kind !== "upsert" || removedMark.kind !== "upsert") {
    throw new Error("Expected tracked mark projections");
  }
  retainedMark.coordinate.parserVersion = "uspto-projection-v1";
  removedMark.coordinate.parserVersion = "uspto-projection-v1";
  removedMark.serialNumber = "74668072";
  const observations: TrademarkProjection[] = [retainedMark, removedMark].map((item) => ({
    coordinate: { ...item.coordinate, filename: "newer.zip", physicalRecordIndex: 2 },
    kind: "observe",
    serialNumber: item.serialNumber,
    snapshotHash: "d".repeat(64),
    sourceTransactionDate: "2026-01-02",
  }));
  const corrected: TrademarkProjection = {
    ...retainedMark,
    coordinate: { ...retainedMark.coordinate, parserVersion: "uspto-projection-v2" },
    snapshotHash: "e".repeat(64),
    wordMark: "CORRECTED",
  };
  const invalidated: TrademarkProjection = {
    coordinate: { ...removedMark.coordinate, parserVersion: "uspto-projection-v2" },
    kind: "observe",
    serialNumber: removedMark.serialNumber,
    snapshotHash: "f".repeat(64),
    sourceTransactionDate: removedMark.sourceTransactionDate,
  };

  await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [retainedMark, removedMark], now)
  );
  await database.begin((transaction) => applyTrademarkBatch(transaction, observations, now));
  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [corrected, invalidated], now)
  );

  expect(result).toMatchObject({
    appliedRecordCount: 2,
    materialChangeCount: 2,
    unresolvedRecordCount: 0,
  });
  expect([
    ...(await database`select serial_number, word_mark from mark order by serial_number`),
  ]).toEqual([{ serial_number: retainedMark.serialNumber, word_mark: "CORRECTED" }]);
  expect([
    ...(await database`
      select serial_number, source_filename, source_transaction_date::text as date
      from trademark_recency order by serial_number
    `),
  ]).toEqual([
    { date: "2026-01-02", serial_number: retainedMark.serialNumber, source_filename: "newer.zip" },
    { date: "2026-01-02", serial_number: removedMark.serialNumber, source_filename: "newer.zip" },
  ]);
});

test("large child collections stay inside PostgreSQL statement limits", async () => {
  const projections = Array.from({ length: 250 }, (_item, index) => {
    const item = projection({
      sourceTransactionDate: "2026-01-01",
      wordMark: `MARK ${index}`,
    });
    if (item.kind !== "upsert") {
      throw new Error("Expected an upsert projection");
    }
    const serialNumber = String(74_000_000 + index);
    return {
      ...item,
      classes: Array.from({ length: 30 }, (_class, ordinal) => ({
        internationalCode: String(ordinal + 1).padStart(3, "0"),
        statusCode: "6",
        statusDate: "2026-01-01",
      })),
      goodsServices: Array.from({ length: 33 }, (_goods, ordinal) => ({
        text: `goods ${ordinal}`,
        typeCode: "GS0251",
      })),
      owners: Array.from({ length: 30 }, (_owner, ordinal) => ({
        entryNumber: String(ordinal + 1),
        partyName: `Owner ${ordinal}`,
        partyType: "10",
      })),
      serialNumber,
      snapshotHash: createHash("sha256").update(serialNumber).digest("hex"),
    };
  });

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, projections, now)
  );

  expect(result).toMatchObject({ appliedRecordCount: 250, unresolvedRecordCount: 0 });
  expect([
    ...(await database`
      select
        (select count(*)::int from mark_class) as classes,
        (select count(*)::int from mark_goods_services) as goods,
        (select count(*)::int from mark_owner) as owners
    `),
  ]).toEqual([{ classes: 7500, goods: 8250, owners: 7500 }]);
});

test("a parser correction removes only the invalid mark from the corrected coordinate", async () => {
  const legacy = projection({ sourceTransactionDate: "2026-01-01", wordMark: "INVALID" });
  legacy.coordinate.parserVersion = "uspto-projection-v1";
  await database.begin((transaction) => applyTrademarkBatch(transaction, [legacy], now));
  const corrected: TrademarkProjection = {
    coordinate: { ...legacy.coordinate, parserVersion: "uspto-projection-v2" },
    kind: "observe",
    serialNumber: legacy.serialNumber,
    snapshotHash: "c".repeat(64),
    sourceTransactionDate: legacy.sourceTransactionDate,
  };

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [corrected], now)
  );

  expect(result).toMatchObject({ materialChangeCount: 1, unresolvedRecordCount: 0 });
  expect([
    ...(await database`select serial_number from mark where serial_number = ${legacy.serialNumber}`),
  ]).toEqual([]);
  expect([
    ...(await database`
      select parser_version from trademark_recency where serial_number = ${legacy.serialNumber}
    `),
  ]).toEqual([{ parser_version: "uspto-projection-v2" }]);
});

test("a content revision removes only the invalid mark from the corrected source file", async () => {
  const legacy = projection({ sourceTransactionDate: "2026-01-01", wordMark: "INVALID" });
  await database.begin((transaction) => applyTrademarkBatch(transaction, [legacy], now));
  const corrected: TrademarkProjection = {
    coordinate: {
      ...legacy.coordinate,
      contentRevision: 2,
      sha256: "b".repeat(64),
    },
    kind: "observe",
    serialNumber: legacy.serialNumber,
    snapshotHash: "c".repeat(64),
    sourceTransactionDate: legacy.sourceTransactionDate,
  };

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [corrected], now)
  );

  expect(result).toMatchObject({ materialChangeCount: 1, unresolvedRecordCount: 0 });
  expect([
    ...(await database`select serial_number from mark where serial_number = ${legacy.serialNumber}`),
  ]).toEqual([]);
  expect([
    ...(await database`
      select content_revision from trademark_recency where serial_number = ${legacy.serialNumber}
    `),
  ]).toEqual([{ content_revision: 2 }]);
});

test("a migrated legacy snapshot yields to the first equal-date logical snapshot", async () => {
  const initial = projection({ sourceTransactionDate: "2026-01-01", wordMark: "LEGACY" });
  await database.begin((transaction) => applyTrademarkBatch(transaction, [initial], now));
  await database`
    update trademark_recency set snapshot_hash = ${"0".repeat(64)}, parser_version = 'uspto-projection-v1'
    where serial_number = ${initial.serialNumber}
  `;
  const replacement = projection({
    filename: "later-package.zip",
    snapshotHash: "b".repeat(64),
    sourceTransactionDate: "2026-01-01",
    wordMark: "CURRENT",
  });

  const result = await database.begin((transaction) =>
    applyTrademarkBatch(transaction, [replacement], now)
  );

  expect(result).toMatchObject({ appliedRecordCount: 1, unresolvedRecordCount: 0 });
  expect([
    ...(await database`select word_mark from mark where serial_number = ${initial.serialNumber}`),
  ]).toEqual([{ word_mark: "CURRENT" }]);
});

test("a completed broad source group covers an older blocked file", async () => {
  const objectKey = "sha256/broad-part-02";
  retained.add(objectKey);
  documents.set(objectKey, sourceDocument(recordFor(annualFilename)));
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state, sha256, object_key
    ) values
      ('71000000-0000-4000-8000-000000000001', 'TRTDXFAP', 'apc250701.zip', 1,
        '1884-04-07', '2025-07-01', 'blocked', 'pending', null, null),
      ('71000000-0000-4000-8000-000000000002', 'TRTYRAP', 'broad-01.zip', 1,
        '1884-04-07', '2025-12-31', 'downloaded', 'complete', ${sha}, null),
      ('71000000-0000-4000-8000-000000000003', 'TRTYRAP', 'broad-02.zip', 1,
        '1884-04-07', '2025-12-31', 'downloaded', 'pending', ${sha}, ${objectKey})
  `;

  expect(await ingestion(catalog()).reconcile()).toMatchObject({
    action: "artifact-applied",
    filename: "broad-02.zip",
  });
  expect([
    ...(await database`
      select processing_disposition from source_artifact where filename = 'apc250701.zip'
    `),
  ]).toEqual([{ processing_disposition: "covered" }]);
  expect((await readTrademarkIngestionStatus(database)).attentionCount).toBe(0);
});

test("a newly blocked file is covered by an already completed broad source", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state, sha256
    ) values
      ('71000000-0000-4000-8000-000000000001', 'TRTYRAP', 'broad.zip', 1,
        '1884-04-07', '2025-12-31', 'downloaded', 'complete', ${sha}),
      ('71000000-0000-4000-8000-000000000002', 'TRTDXFAP', 'apc250701.zip', 1,
        '2025-07-01', '2025-07-01', 'pending', 'pending', null)
  `;
  await database`
    update worker_status set last_discovery_at = ${now} where id = 'uspto'
  `;
  const module = ingestion(
    catalog({
      download: () => {
        throw new SourceContractError("USPTO rejected this file request");
      },
    })
  );

  expect(await module.reconcile()).toMatchObject({
    action: "artifact-download-blocked",
    filename: "apc250701.zip",
  });
  expect([
    ...(await database`
      select processing_disposition from source_artifact where filename = 'apc250701.zip'
    `),
  ]).toEqual([{ processing_disposition: "covered" }]);
  expect((await readTrademarkIngestionStatus(database)).attentionCount).toBe(0);
});

test("status describes source progress without gating the database", async () => {
  await database`
    insert into source_artifact (
      id, product, filename, expected_bytes, source_from_date, source_to_date, download_state,
      application_state, current_error
    ) values
      ('71000000-0000-4000-8000-000000000001', 'TRTDXFAP', 'apc260101.zip', 1,
        '2026-01-01', '2026-01-01', 'downloaded', 'complete', null),
      ('71000000-0000-4000-8000-000000000002', 'TRTDXFAP', 'apc260102.zip', 1,
        '2026-01-02', '2026-01-02', 'blocked', 'pending', 'rate limited'),
      ('71000000-0000-4000-8000-000000000003', 'TRTDXFAP', 'apc260103.zip', 1,
        '2026-01-03', '2026-01-03', 'downloaded', 'needs_attention', 'one bad record')
  `;
  await database`
    update source_artifact set applied_record_count = 10, physical_record_count = 11,
      application_completed_at = current_timestamp where filename = 'apc260103.zip'
  `;
  const [today] = await database<Array<{ date: string }>>`
    select (current_timestamp at time zone 'UTC')::date::text as date
  `;
  if (!today) {
    throw new Error("Current PostgreSQL date is unavailable");
  }
  const status = await readTrademarkIngestionStatus(database);
  expect(status).toMatchObject({
    attentionCount: 2,
    currentArtifact: null,
    dataVersion: 0,
    latestProcessedDate: "2026-01-03",
    pendingArtifactCount: 0,
    worker: { activity: "idle" },
  });
  await database`
    update worker_status set activity = 'discovering', current_filename = null,
      last_heartbeat_at = ${now}, updated_at = ${now} where id = 'uspto'
  `;
  expect((await readTrademarkIngestionStatus(database, now)).currentArtifact).toEqual({
    filename: "USPTO source catalog",
    state: "discovering",
  });
  const staleAt = new Date(now.getTime() + 5 * 60 * 1000 + 1);
  expect((await readTrademarkIngestionStatus(database, staleAt)).currentArtifact).toBeNull();
  expect(
    await database.begin(async (transaction) => {
      await transaction`set transaction isolation level repeatable read`;
      return readDataSnapshot(transaction);
    })
  ).toEqual({ dataVersion: "0" });
  expect(await readOperatorProcessingActivity(database)).toContainEqual({
    count: 10,
    date: today.date,
  });
  expect(
    await createMarksService(database).search({
      limit: 25,
      match: "both",
      mode: "multi",
      offset: 0,
      query: "shirt",
      registered: "all",
      sort: "relevance",
      status: "all",
      type: "all",
    })
  ).toMatchObject({ items: [], total: 0 });
});

function ingestion(
  sourceCatalog: SourceCatalog,
  extractXml: ((archivePath: string) => Promise<Readable>) | undefined = async (archivePath) =>
    Readable.from([documents.get(archivePath) ?? ""]),
  store: ArtifactStore = artifactStore
) {
  return createTrademarkIngestion({
    artifactStore: store,
    database,
    extractXml,
    now: () => now,
    sourceCatalog,
  });
}

function catalog(overrides: Partial<SourceCatalog> = {}): SourceCatalog {
  return {
    discover: async (product) =>
      product === "TRTYRAP"
        ? discovered("TRTYRAP", "YEARLY", [artifact(annualFilename, "1884-04-07", "2025-12-31")])
        : discovered("TRTDXFAP", "DAILY", [
            artifact("apc251231.zip", "2025-12-31", "2025-12-31"),
            artifact(dailyFilename, "2026-01-01", "2026-01-01"),
          ]),
    download: ({ filename }) => {
      downloaded.push(filename);
      return Promise.resolve(download(filename));
    },
    ...overrides,
  };
}

function download(filename: string) {
  return Promise.resolve({
    body: new Blob([filename]).stream(),
    expectedBytes: Buffer.byteLength(filename),
    responseState: { status: 200 },
  });
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

function projection(options: {
  filename?: string;
  physicalRecordIndex?: number;
  snapshotHash?: string;
  sourceTransactionDate: string;
  wordMark: string;
}): TrademarkProjection {
  return {
    classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2026-01-01" }],
    coordinate: {
      contentRevision: 1,
      filename: options.filename ?? "source.zip",
      parserVersion: "uspto-projection-v2",
      physicalRecordIndex: options.physicalRecordIndex ?? 1,
      product: "TRTDXFAP",
      sha256: sha,
    },
    filingDate: "2026-01-01",
    goodsServices: [{ text: "shirts", typeCode: "GS0251" }],
    kind: "upsert",
    markDrawingCode: "1",
    owners: [],
    registrationDate: null,
    registrationNumber: null,
    serialNumber: "74668071",
    snapshotHash:
      options.snapshotHash ?? createHash("sha256").update(options.wordMark).digest("hex"),
    sourceTransactionDate: options.sourceTransactionDate,
    statusCode: "630",
    statusDate: options.sourceTransactionDate,
    statusEvents: [],
    wordMark: options.wordMark,
  };
}
