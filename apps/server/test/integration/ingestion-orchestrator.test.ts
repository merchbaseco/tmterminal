import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { PgBoss } from "pg-boss";
import postgres from "postgres";

import { migrateDatabase, migrateSchedulerDatabase } from "../../src/db/migrate.ts";
import { quarantineArtifactVersion } from "../../src/ingestion/artifact-quarantine.ts";
import { createIngestionReconciler } from "../../src/ingestion/ingestion-reconciler.ts";
import {
  createIngestionScheduler,
  reconcileQueue,
  reconcileQueueOptions,
} from "../../src/ingestion/ingestion-scheduler.ts";
import { createSyncService } from "../../src/services/sync-service.ts";
import { extractZipXml } from "../../src/ingestion/zip-artifact-xml.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");

const database = postgres(databaseUrl, { max: 1, prepare: false });

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  await migrateSchedulerDatabase(databaseUrl);
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await Bun.sleep(50);
  }
  throw new Error("scheduler did not deliver reconciliation");
}

async function jobCount(state: "active" | "completed" | "failed") {
  const [row] = await database<Array<{ count: number }>>`
    select count(*)::int as count from pgboss.job
    where name = 'ingestion-reconcile' and state = ${state}
  `;
  return row?.count ?? 0;
}

test("pg-boss schema migration is clean and idempotent", async () => {
  await migrateSchedulerDatabase(databaseUrl);
  await migrateSchedulerDatabase(databaseUrl);
  const [version] = await database<Array<{ count: number }>>`
    select count(*)::int as count from pgboss.version
  `;
  const boss = new PgBoss({ connectionString: databaseUrl, migrate: false, supervise: false });
  await boss.start();
  const drift = await boss.detectSchemaDrift();
  await boss.stop({ close: true, graceful: true, timeout: 30_000 });

  expect(version?.count).toBe(1);
  expect(drift.ok).toBe(true);
});

const emptyXml = Buffer.from(
  "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202607150000</creation-datetime><application-information><data-available-code>N</data-available-code></application-information></trademark-applications-daily>",
);

async function retainVerifiedArtifact(input: { bytes?: Buffer; objectKey?: string } = {}) {
  const artifactId = randomUUID();
  const artifactVersionId = randomUUID();
  const discoveryId = randomUUID();
  await database`insert into dataset_product (id) values ('TRTDXFAP') on conflict (id) do nothing`;
  await database`
    insert into artifact (id, product_id, filename)
    values (${artifactId}, 'TRTDXFAP', ${`${artifactId}.zip`})
  `;
  const bytes = input.bytes ?? emptyXml;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key)
    values (
      ${artifactVersionId}, ${artifactId}, ${createHash("sha256").update(bytes).digest("hex")},
      ${bytes.byteLength}, ${input.objectKey ?? "fixture/apc260715.zip"}
    )
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_url, expected_bytes,
      source_from_date, source_to_date, release_date, source_last_modified_at, download_state
    ) values (
      ${discoveryId}, ${artifactId}, ${artifactVersionId}, ${"b".repeat(64)}, now(), 'https://example.test/apc260715.zip',
      ${bytes.byteLength}, '2026-07-15', '2026-07-15', '2026-07-15', now(), 'verified'
    )
  `;
  return artifactVersionId;
}

const noXmlZip = Buffer.from("UEsDBAoAAAAAAEeH71zHp4s7BAAAAAQAAAAKABwAcmVhZG1lLnR4dFVUCQADZvRXamb0V2p1eAsAAQT1AQAABBQAAAB0ZXh0UEsBAh4DCgAAAAAAR4fvXMenizsEAAAABAAAAAoAGAAAAAAAAQAAAKSBAAAAAHJlYWRtZS50eHRVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAEAAQBQAAAASAAAAAAA", "base64");
const multipleXmlZip = Buffer.from("UEsDBAoAAAAAAEeH71zUHNEBBAAAAAQAAAAFABwAYS54bWxVVAkAA2b0V2pm9FdqdXgLAAEE9QEAAAQUAAAAPGEvPlBLAwQKAAAAAABHh+9cjaKXAwQAAAAEAAAABQAcAGIueG1sVVQJAANm9FdqZvRXanV4CwABBPUBAAAEFAAAADxiLz5QSwECHgMKAAAAAABHh+9c1BzRAQQAAAAEAAAABQAYAAAAAAABAAAApIEAAAAAYS54bWxVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAABHh+9cjaKXAwQAAAAEAAAABQAYAAAAAAABAAAApIFDAAAAYi54bWxVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAIAAgCWAAAAhgAAAAAA", "base64");

for (const [shape, bytes, reason] of [
  ["invalid", Buffer.from("not a zip"), "Artifact ZIP is invalid"],
  ["no XML", noXmlZip, "Artifact ZIP contains no XML file"],
  ["multiple XML", multipleXmlZip, "Artifact ZIP contains more than one XML file"],
] as const) {
  test(`${shape} retained ZIP durably quarantines its exact version`, async () => {
    const artifactVersionId = await retainVerifiedArtifact({ bytes, objectKey: `fixture/${shape}.zip` });
    const reconciler = createIngestionReconciler({
      artifactScheduler: { runOnce: async () => ({ status: "idle" as const }) },
      artifactStore: { get: async () => new Blob([bytes]).stream() },
      database,
      extractXml: extractZipXml,
    });

    expect(await reconciler.reconcile()).toEqual({ action: "quarantine", artifactVersionId, reason });
    const [version] = await database<Array<{ quarantinedAt: Date; quarantineReason: string; state: string }>>`
      select state, quarantined_at as "quarantinedAt", quarantine_reason as "quarantineReason"
      from artifact_version where id = ${artifactVersionId}
    `;
    expect(version).toMatchObject({ quarantineReason: reason, state: "quarantined" });
    expect(version?.quarantinedAt).toBeInstanceOf(Date);
  });
}

test("missing retained bytes durably quarantine the exact version", async () => {
  const artifactVersionId = await retainVerifiedArtifact({ objectKey: "fixture/missing.zip" });
  const reconciler = createIngestionReconciler({
    artifactScheduler: { runOnce: async () => ({ status: "idle" as const }) },
    artifactStore: { get: async () => { throw new Error("ENOENT /private/path"); } },
    database,
    extractXml: extractZipXml,
  });

  expect(await reconciler.reconcile()).toEqual({
    action: "quarantine",
    artifactVersionId,
    reason: "Retained artifact bytes could not be read",
  });
  const [version] = await database<Array<{ quarantineReason: string; state: string }>>`
    select state, quarantine_reason as "quarantineReason" from artifact_version where id = ${artifactVersionId}
  `;
  expect(version).toEqual({
    quarantineReason: "Retained artifact bytes could not be read",
    state: "quarantined",
  });
});

test("quarantine after reconciliation selection remains terminal before parsing", async () => {
  const artifactVersionId = await retainVerifiedArtifact();
  const reason = "Operator quarantined retained evidence after reconciliation selected it";
  const reconciler = createIngestionReconciler({
    artifactScheduler: { runOnce: async () => ({ status: "idle" as const }) },
    artifactStore: {
      get: async () => {
        await quarantineArtifactVersion(database, artifactVersionId, reason);
        return new Blob([emptyXml]).stream();
      },
    },
    database,
    extractXml: (archive) => archive,
  });

  await expect(reconciler.reconcile()).rejects.toThrow(
    "Artifact version must be verified, staged, or published to parse",
  );
  const [version] = await database<Array<{ quarantineReason: string; state: string }>>`
    select state, quarantine_reason as "quarantineReason"
    from artifact_version where id = ${artifactVersionId}
  `;
  const [parseRuns] = await database<Array<{ count: number }>>`
    select count(*)::int as count from parse_run where artifact_version_id = ${artifactVersionId}
  `;
  const [publications] = await database<Array<{ count: number }>>`
    select count(*)::int as count from publication
  `;
  expect(version).toEqual({ quarantineReason: reason, state: "quarantined" });
  expect(parseRuns?.count).toBe(0);
  expect(publications?.count).toBe(0);
});

test("one pg-boss scheduler delivers reconciliation again after process restart", async () => {
  let firstProcessRuns = 0;
  const first = createIngestionScheduler({
    databaseUrl,
    pollMs: 10_000,
    reconcile: async () => { firstProcessRuns += 1; },
  });
  await first.start();
  await waitFor(() => firstProcessRuns === 1);
  await first.stop();

  let restartedProcessRuns = 0;
  const restarted = createIngestionScheduler({
    databaseUrl,
    pollMs: 10_000,
    reconcile: async () => { restartedProcessRuns += 1; },
  });
  await restarted.start();
  await waitFor(() => restartedProcessRuns === 1);
  await restarted.stop();

  expect(firstProcessRuns).toBe(1);
  expect(restartedProcessRuns).toBe(1);
});

test("a failed handler remains degraded until a later reconciliation succeeds", async () => {
  const failed = createIngestionScheduler({
    databaseUrl,
    pollMs: 10_000,
    reconcile: async () => { throw new Error("retained artifact object is missing"); },
  });
  await failed.start();
  expect(await failed.waitForFirstReconciliation()).toEqual({ ok: false });
  await waitFor(async () => await jobCount("failed") === 1);
  expect(await createSyncService(database).status()).toMatchObject({
    activeState: "failed",
    degraded: true,
    failedCount: 1,
  });
  await failed.stop();

  const recovered = createIngestionScheduler({
    databaseUrl,
    pollMs: 10_000,
    reconcile: async () => ({ status: "idle" }),
  });
  await recovered.start();
  await waitFor(async () => await jobCount("completed") >= 1);
  expect(await createSyncService(database).status()).toMatchObject({
    activeState: "idle",
    failedCount: 0,
  });
  await recovered.stop();
});

test("corpus notification wakes the same reconcile queue", async () => {
  let runs = 0;
  const scheduler = createIngestionScheduler({
    databaseUrl,
    pollMs: 60_000,
    reconcile: async () => { runs += 1; },
  });
  await scheduler.start();
  await waitFor(() => runs === 1);
  await database.notify("corpus_events", randomUUID());
  await waitFor(() => runs === 2);
  await scheduler.stop();
  expect(runs).toBe(2);
});

test("duplicate wakeups yield one exclusive delivery and one worker claim", async () => {
  const first = new PgBoss({ connectionString: databaseUrl, migrate: false, supervise: false });
  const second = new PgBoss({ connectionString: databaseUrl, migrate: false, supervise: false });
  await first.start();
  await second.start();
  await first.createQueue(reconcileQueue, reconcileQueueOptions);
  const [firstDelivery, duplicateDelivery] = await Promise.all([
    first.send(reconcileQueue, { reason: "duplicate-test" }),
    second.send(reconcileQueue, { reason: "duplicate-test" }),
  ]);
  const claims = await Promise.all([
    first.fetch(reconcileQueue),
    second.fetch(reconcileQueue),
  ]);
  const claimed = claims.flat();
  expect([firstDelivery, duplicateDelivery].filter(Boolean)).toHaveLength(1);
  expect(claimed).toHaveLength(1);
  await first.complete(reconcileQueue, claimed[0]!.id);
  await first.stop({ close: true, graceful: true, timeout: 30_000 });
  await second.stop({ close: true, graceful: true, timeout: 30_000 });
});

test("an orphaned heartbeat lease expires and restart re-derives database work", async () => {
  const artifactVersionId = await retainVerifiedArtifact();
  const orphan = new PgBoss({
    connectionString: databaseUrl,
    migrate: false,
    monitorIntervalSeconds: 1,
    supervise: false,
  });
  await orphan.start();
  await orphan.createQueue(reconcileQueue, reconcileQueueOptions);
  await orphan.send(reconcileQueue, { reason: "orphan-test" });
  const [claimed] = await orphan.fetch(reconcileQueue);
  expect(claimed?.id).toBeString();
  await database`
    update pgboss.job
    set heartbeat_on = now() - interval '2 minutes'
    where id = ${claimed!.id}
  `;
  await database`update pgboss.queue set monitor_on = null where name = ${reconcileQueue}`;
  await orphan.supervise(reconcileQueue);
  expect(await jobCount("failed")).toBe(1);
  await orphan.stop({ close: true, graceful: true, timeout: 30_000 });

  const reconciler = createIngestionReconciler({
    artifactScheduler: { runOnce: async () => ({ status: "idle" as const }) },
    artifactStore: { get: async () => new ReadableStream({
      start(controller) { controller.enqueue(emptyXml); controller.close(); },
    }) },
    database,
    extractXml: (archive: ReadableStream<Uint8Array>) => archive,
  });
  const restarted = createIngestionScheduler({
    databaseUrl,
    pollMs: 60_000,
    reconcile: () => reconciler.reconcile(),
  });
  await restarted.start();
  expect(await restarted.waitForFirstReconciliation()).toEqual({ ok: true });
  const [recovered] = await database<Array<{ count: number }>>`
    select count(*)::int as count from parse_run where artifact_version_id = ${artifactVersionId}
  `;
  expect(recovered?.count).toBe(1);
  await restarted.stop();
});

test("scheduler startup fails closed when the pg-boss schema is absent", async () => {
  await database.unsafe("drop schema pgboss cascade");
  const scheduler = createIngestionScheduler({
    databaseUrl,
    pollMs: 10_000,
    reconcile: async () => undefined,
  });
  await expect(scheduler.start()).rejects.toThrow();
});

test("database reconciliation resumes a retained artifact after process restart", async () => {
  const artifactVersionId = await retainVerifiedArtifact();
  const sourceRuns: string[] = [];
  const options = {
    artifactScheduler: { runOnce: async () => ({ status: "idle" as const }) },
    artifactStore: { get: async (objectKey: string) => {
      sourceRuns.push(objectKey);
      return new ReadableStream({ start(controller) { controller.enqueue(emptyXml); controller.close(); } });
    } },
    database,
    extractXml: (archive: ReadableStream<Uint8Array>) => archive,
  };

  expect(await createIngestionReconciler(options).reconcile()).toMatchObject({ action: "parse", artifactVersionId });
  expect(await createIngestionReconciler(options).reconcile()).toMatchObject({ action: "source" });

  const [state] = await database<Array<{ parseRuns: number; versionState: string }>>`
    select
      (select count(*)::int from parse_run where artifact_version_id = ${artifactVersionId}) as "parseRuns",
      (select state from artifact_version where id = ${artifactVersionId}) as "versionState"
  `;
  expect(state).toEqual({ parseRuns: 1, versionState: "staged" });
  expect(sourceRuns).toEqual(["fixture/apc260715.zip"]);
});

test("provider backoff does not block database-derived local parsing", async () => {
  const artifactVersionId = await retainVerifiedArtifact();
  await database`
    insert into source_lane (id, status, next_eligible_at)
    values ('uspto-odp', 'backoff', '2026-07-16T00:00:00Z')
  `;
  const reconciler = createIngestionReconciler({
    artifactScheduler: { runOnce: async () => { throw new Error("source scheduler must not run before local work"); } },
    artifactStore: { get: async () => new ReadableStream({
      start(controller) { controller.enqueue(emptyXml); controller.close(); },
    }) },
    database,
    extractXml: (archive: ReadableStream<Uint8Array>) => archive,
  });

  expect(await reconciler.reconcile()).toMatchObject({ action: "parse", artifactVersionId });
});

test("normal reconciliation does not replay published or quarantined versions", async () => {
  const published = await retainVerifiedArtifact();
  const quarantined = await retainVerifiedArtifact();
  const verified = await retainVerifiedArtifact();
  await database`update artifact_version set state = 'published' where id = ${published}`;
  await database`update artifact_version set state = 'quarantined' where id = ${quarantined}`;
  const opened: string[] = [];
  const reconciler = createIngestionReconciler({
    artifactScheduler: { runOnce: async () => ({ status: "idle" as const }) },
    artifactStore: { get: async (objectKey: string) => {
      opened.push(objectKey);
      return new ReadableStream({ start(controller) { controller.enqueue(emptyXml); controller.close(); } });
    } },
    database,
    extractXml: (archive: ReadableStream<Uint8Array>) => archive,
  });

  expect(await reconciler.reconcile()).toMatchObject({ action: "parse", artifactVersionId: verified });
  expect(opened).toEqual(["fixture/apc260715.zip"]);
  const runs = await database<Array<{ artifactVersionId: string }>>`
    select artifact_version_id as "artifactVersionId" from parse_run order by artifact_version_id
  `;
  expect([...runs]).toEqual([{ artifactVersionId: verified }]);
});

test("ineligible publication staging does not starve source reconciliation", async () => {
  let sourceRuns = 0;
  const reconciler = createIngestionReconciler({
    artifactScheduler: { runOnce: async () => ({ run: ++sourceRuns, status: "idle" as const }) },
    artifactStore: { get: async () => { throw new Error("no retained artifact expected"); } },
    database,
    extractXml: (archive: ReadableStream<Uint8Array>) => archive,
  });

  expect(await reconciler.reconcile()).toEqual({ action: "source", source: { run: 1, status: "idle" } });
  expect(await reconciler.reconcile()).toEqual({ action: "source", source: { run: 2, status: "idle" } });
});
