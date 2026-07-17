import { afterAll, beforeEach, expect, test } from "bun:test";
import { Readable } from "node:stream";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { createAnnualCorpusIngestion } from "../../src/ingestion/annual-corpus.ts";
import { annualGenerationV1Artifacts } from "../../src/ingestion/annual-generation-v1.ts";
import { SourceTransportError } from "../../src/ingestion/source-catalog.ts";
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
  extractXml = () => Promise.resolve(Readable.from([annualDocument(validRecord)]))
) {
  return createAnnualCorpusIngestion({
    artifactStore: store,
    database,
    extractXml,
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog: unavailableSource,
  });
}
const generationId = "70000000-0000-4000-8000-000000000001";
const sha = "a".repeat(64);
const validRecord =
  "<case-file><serial-number>74668071</serial-number><registration-number>1974886</registration-number><transaction-date>20230825</transaction-date><case-file-header><filing-date>19950501</filing-date><registration-date>19960521</registration-date><status-code>800</status-code><status-date>20160607</status-date><mark-identification>GUESS JEANS</mark-identification><mark-drawing-code>1</mark-drawing-code></case-file-header><classifications><international-code>025</international-code><status-code>6</status-code><status-date>19950706</status-date><primary-code>025</primary-code></classifications><case-file-statements><case-file-statement><type-code>GS0251</type-code><text>shirts</text></case-file-statement></case-file-statements></case-file>";
function annualDocument(record: string) {
  return `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><application-information><file-segments><file-segment>1</file-segment><action-keys><action-key>TX</action-key>${record}</action-keys></file-segments></application-information></trademark-applications-daily>`;
}
async function seedGeneration(expected = 91) {
  await database`insert into corpus_generation (id, product, from_date, to_date, expected_artifact_count) values (${generationId}, 'TRTYRAP', '1884-04-07', '2025-12-31', ${expected})`;
}
async function seedArtifact(
  index: number,
  state: "complete" | "downloading" | "pending" | "projecting",
  objectKey: string | null = null
) {
  await database`insert into source_artifact (id, generation_id, product, filename, download_url, expected_bytes, source_from_date, source_to_date, state, sha256, object_key) values (${`71000000-0000-4000-8000-${String(index).padStart(12, "0")}`}, ${generationId}, 'TRTYRAP', ${`annual-${String(index).padStart(2, "0")}.zip`}, 'https://example.test/annual.zip', 1, '1884-04-07', '2025-12-31', ${state}, ${sha}, ${objectKey})`;
}
async function seedMark(wordMark: string) {
  await database`insert into mark (generation_id, serial_number, word_mark, status_code, normalization_version, source_product, source_filename, source_sha256, source_physical_record_index) values (${generationId}, '74668071', ${wordMark}, '800', 'uspto-normalization-v1', 'TRTYRAP', 'annual.zip', ${sha}, 1)`;
}

beforeEach(async () => {
  removed.length = 0;
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});
afterAll(() => database.end({ timeout: 1 }));

test("discovers only the exact pinned annual generation", async () => {
  const sourceCatalog = {
    discover: async () => ({
      artifacts: [...annualGenerationV1Artifacts].map((filename) => ({
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
  const module = createAnnualCorpusIngestion({
    artifactStore: store,
    database,
    extractXml: async () => Readable.from([]),
    retry: { baseMs: 1, jitter: () => 0, maxMs: 2 },
    sourceCatalog,
  });
  expect(await module.reconcile()).toMatchObject({ action: "discovered", artifactCount: 91 });
  expect((await module.status()).pendingArtifactCount).toBe(91);
});

test("removes one unreferenced raw ZIP before starting corpus work", async () => {
  const orphanStore = {
    ...store,
    async *listObjectKeys() {
      await Promise.resolve();
      yield "sha256/orphan";
    },
  };
  const module = createAnnualCorpusIngestion({
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

test("keeps 90 of 91 invisible and atomically activates exactly 91", async () => {
  await seedGeneration();
  await Promise.all(Array.from({ length: 90 }, (_, index) => seedArtifact(index + 1, "complete")));
  await seedMark("BUILDING MARK");
  expect(await ingestion().reconcile()).toEqual({ action: "idle" });
  await expect(
    createMarksService(database).search({
      limit: 25,
      match: "exact",
      mode: "multi",
      offset: 0,
      query: "BUILDING MARK",
      registered: "all",
      sort: "relevance",
      status: "all",
      type: "all",
    })
  ).rejects.toThrow("unavailable");

  await seedArtifact(91, "complete");
  expect(await ingestion().reconcile()).toMatchObject({
    action: "activated",
    corpusVersion: 1,
    generationId,
    markCount: 1,
  });
  const page = await createMarksService(database).search({
    limit: 25,
    match: "exact",
    mode: "multi",
    offset: 0,
    query: "BUILDING MARK",
    registered: "all",
    sort: "relevance",
    status: "all",
    type: "all",
  });
  expect(page.total).toBe(1);
  expect(page.meta).toEqual({ corpusThroughDate: "2025-12-31", corpusVersion: "1" });
  const exact = await createMarksService(database).getBySerialNumber("74668071");
  expect(exact).toMatchObject({
    mark: { serialNumber: "74668071", wordMark: "BUILDING MARK" },
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
  expect(await ingestion().reconcile()).toEqual({ action: "idle" });
  expect((await ingestion().status()).corpusVersion).toBe(1);
});

test("restart resumes one projecting artifact and removes its ZIP after commit", async () => {
  await seedGeneration();
  await seedArtifact(1, "projecting", "sha256/object");
  expect(await ingestion().reconcile()).toMatchObject({
    action: "projected",
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
});

test("terminal projection failure leaves a clear error and no ZIP", async () => {
  await seedGeneration();
  await seedArtifact(1, "projecting", "sha256/object");
  const broken = async () =>
    Readable.from([annualDocument("<case-file><serial-number>bad</serial-number></case-file>")]);
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
  await seedGeneration();
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
    createAnnualCorpusIngestion({
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
  await seedGeneration();
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
    createAnnualCorpusIngestion({
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
  await seedGeneration();
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
  const module = createAnnualCorpusIngestion({
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
    currentError: "Annual artifact response length changed from its catalog value",
    failureCount: 1,
    status: "stopped",
  });
});

test("atomically resets old provider failures with a committed download", async () => {
  await seedGeneration();
  await seedArtifact(1, "pending");
  await database`
    insert into source_lane (id, status, failure_count, current_error, next_eligible_at)
    values ('uspto-odp', 'backoff', 7, 'old failure', '2025-01-01T00:00:00Z')
  `;
  const module = createAnnualCorpusIngestion({
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
  await seedGeneration();
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
  const module = createAnnualCorpusIngestion({
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
      artifacts: [...annualGenerationV1Artifacts].map((filename) => ({
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
  const module = createAnnualCorpusIngestion({
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
  const [rolledBack] = await database<
    Array<{ artifacts: number; failureCount: number; generations: number }>
  >`
    select (select count(*)::int from corpus_generation) generations,
      (select count(*)::int from source_artifact) artifacts,
      failure_count::int as "failureCount" from source_lane where id = 'uspto-odp'
  `;
  expect(rolledBack).toEqual({ artifacts: 0, failureCount: 3, generations: 0 });

  expect(await module.reconcile()).toMatchObject({ action: "discovered", artifactCount: 91 });
  expect((await module.status()).lane).toMatchObject({ failureCount: 0, status: "ready" });
});

test("stops the same artifact after eight durable download attempts", async () => {
  await seedGeneration();
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
    createAnnualCorpusIngestion({
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
