import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import postgres from "postgres";

import { migrateDatabase, migrateSchedulerDatabase } from "../../src/db/migrate.ts";
import { annualGenerationV1Artifacts } from "../../src/ingestion/annual-generation-v1.ts";
import { quarantineArtifactVersion } from "../../src/ingestion/artifact-quarantine.ts";
import { createArtifactScheduler } from "../../src/ingestion/artifact-scheduler.ts";
import type { ArtifactStore } from "../../src/ingestion/artifact-store.ts";
import { createIngestionReconciler } from "../../src/ingestion/ingestion-reconciler.ts";
import { reconcileQueue } from "../../src/ingestion/ingestion-scheduler.ts";
import { sourceObservationParserVersion } from "../../src/ingestion/source-observations.ts";
import {
  recoverSourceLane,
  requestFullRebuild,
  selectArtifactVersion,
} from "../../src/ingestion/sync-operations.ts";
import { readOperatorArtifacts } from "../../src/queries/operator-sync-repository.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}
const database = postgres(databaseUrl, { max: 2, prepare: false });

async function* artifactObjectKeys(keys: string[] = []) {
  await Promise.resolve();
  yield* keys;
}

const emptyXml = Buffer.from(
  "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202607150000</creation-datetime><application-information><data-available-code>N</data-available-code></application-information></trademark-applications-daily>"
);

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  await migrateSchedulerDatabase(databaseUrl);
  await database`insert into dataset_product (id) values ('TRTDXFAP'), ('TRTYRAP')`;
});

afterEach(async () => {
  await database`alter table artifact_version alter column object_key drop not null`;
});

async function retainVersion(input: {
  artifactId?: string;
  filename?: string;
  product?: "TRTDXFAP" | "TRTYRAP";
  sourceFromDate?: string;
  sourceToDate?: string;
  state?: "parsing" | "published" | "quarantined" | "staged" | "verified";
  suffix?: string;
}) {
  const artifactId = input.artifactId ?? randomUUID();
  const versionId = randomUUID();
  const suffix = input.suffix ?? randomUUID();
  if (!input.artifactId) {
    await database`
      insert into artifact (id, product_id, filename)
      values (${artifactId}, ${input.product ?? "TRTDXFAP"}, ${input.filename ?? `${artifactId}.zip`})
    `;
  }
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
    values (
      ${versionId}, ${artifactId}, ${createHash("sha256").update(suffix).digest("hex")},
      ${emptyXml.byteLength}, ${`fixtures/${suffix}`}, ${input.state ?? "verified"}
    )
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${artifactId}, ${versionId}, ${createHash("sha256").update(`discovery-${suffix}`).digest("hex")},
      now(), 'verified', 'https://example.test/source.zip', ${emptyXml.byteLength},
      coalesce(${input.sourceFromDate ?? null}::date, current_date),
      coalesce(${input.sourceToDate ?? null}::date, current_date),
      current_date, now()
    )
  `;
  return { artifactId, versionId };
}

async function insertStagedParse(
  versionId: string,
  parserVersion = sourceObservationParserVersion
) {
  const parseRunId = randomUUID();
  await database`
    insert into parse_run (
      id, artifact_version_id, state, parser_version, digest, record_count, reject_count, started_at, finished_at
    ) values (
      ${parseRunId}, ${versionId}, 'staged', ${parserVersion}, ${createHash("sha256").update(versionId).digest("hex")},
      0, 0, now(), now()
    )
  `;
  return parseRunId;
}

test("quarantine persists a private reason and refuses a terminal version", async () => {
  const retained = await retainVersion({ filename: "apc260715.zip" });
  await quarantineArtifactVersion(database, retained.versionId, "Malformed record framing");

  const page = await readOperatorArtifacts(database, { limit: 25, offset: 0 });
  expect(page.items[0]).toMatchObject({
    artifactVersionId: retained.versionId,
    quarantineReason: "Malformed record framing",
    stage: "quarantined",
  });
  await expect(quarantineArtifactVersion(database, retained.versionId, "again")).rejects.toThrow(
    "Artifact version must exist in verified or staged state"
  );
});

test("full rebuild refuses the post-object-lifecycle schema", async () => {
  await retainVersion({ filename: "apc260715.zip" });
  await expect(
    requestFullRebuild({
      artifactStore: { listObjectKeys: artifactObjectKeys, remove: async () => undefined },
      database,
      offlineConfirmed: true,
    })
  ).rejects.toThrow("pre-object-lifecycle migration schema");
});

test("full rebuild discards queued reconciliation wakeups and reports the exact count", async () => {
  await database`alter table artifact_version alter column object_key set not null`;
  await retainVersion({ filename: "apc260715.zip" });
  const boss = new PgBoss({ connectionString: databaseUrl, migrate: false, supervise: false });
  await boss.start();
  let createdJobId: string | null = null;
  let retryJobId: string | null = null;
  try {
    await boss.createQueue(reconcileQueue);
    createdJobId = await boss.send(reconcileQueue, { reason: "cutover-created" });
    retryJobId = await boss.send(reconcileQueue, { reason: "cutover-retry" });
  } finally {
    await boss.stop({ close: true, graceful: true, timeout: 30_000 });
  }
  if (!(createdJobId && retryJobId)) {
    throw new Error("Expected two queued reconciliation fixtures");
  }
  await database`update pgboss.job set state = 'retry' where id = ${retryJobId}`;

  const result = await requestFullRebuild({
    artifactStore: { listObjectKeys: artifactObjectKeys, remove: () => Promise.resolve() },
    database,
    offlineConfirmed: true,
  });
  expect(result.discardedQueuedReconciliations).toBe(2);
  const [remaining] = await database<Array<{ count: number }>>`
    select count(*)::int as count from pgboss.job
    where name = ${reconcileQueue} and state in ('created', 'retry')
  `;
  expect(remaining?.count).toBe(0);
});

test("full rebuild refuses active reconciliation without touching cutover state", async () => {
  await database`alter table artifact_version alter column object_key set not null`;
  const retained = await retainVersion({ filename: "apc260715.zip" });
  const boss = new PgBoss({ connectionString: databaseUrl, migrate: false, supervise: false });
  await boss.start();
  let activeJobId: string | null = null;
  try {
    await boss.createQueue(reconcileQueue);
    activeJobId = await boss.send(reconcileQueue, { reason: "cutover-active" });
  } finally {
    await boss.stop({ close: true, graceful: true, timeout: 30_000 });
  }
  if (!activeJobId) {
    throw new Error("Expected one active reconciliation fixture");
  }
  await database`update pgboss.job set state = 'active' where id = ${activeJobId}`;
  let removeCalls = 0;

  await expect(
    requestFullRebuild({
      artifactStore: {
        listObjectKeys: artifactObjectKeys,
        remove: () => {
          removeCalls += 1;
          return Promise.resolve();
        },
      },
      database,
      offlineConfirmed: true,
    })
  ).rejects.toThrow("active reconciliation delivery");

  const [state] = await database<
    Array<{
      activeJobs: number;
      discoveryState: string;
      objectKey: string | null;
      proofExists: boolean;
    }>
  >`
    select
      (select count(*)::int from pgboss.job where id = ${activeJobId} and state = 'active') as "activeJobs",
      (select download_state from artifact_discovery where artifact_version_id = ${retained.versionId}) as "discoveryState",
      (select object_key from artifact_version where id = ${retained.versionId}) as "objectKey",
      to_regclass('public.prd77_cutover_proof') is not null as "proofExists"
  `;
  expect(state).toEqual({
    activeJobs: 1,
    discoveryState: "verified",
    objectKey: expect.any(String),
    proofExists: false,
  });
  expect(removeCalls).toBe(0);
});

test("reissue selection is exact, and quarantine invalidates its selected staged version", async () => {
  const first = await retainVersion({
    filename: annualGenerationV1Artifacts[0],
    product: "TRTYRAP",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    state: "staged",
    suffix: "first",
  });
  const second = await retainVersion({
    artifactId: first.artifactId,
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    state: "staged",
    suffix: "second",
  });
  await insertStagedParse(first.versionId);
  await insertStagedParse(second.versionId);

  await selectArtifactVersion(
    database,
    first.versionId,
    "Selected after comparing retained source metadata"
  );
  const [selection] = await database<Array<{ artifactVersionId: string; reason: string }>>`
    select artifact_version_id as "artifactVersionId", reason from artifact_version_selection
    where artifact_id = ${first.artifactId}
  `;
  expect(selection).toEqual({
    artifactVersionId: first.versionId,
    reason: "Selected after comparing retained source metadata",
  });
  await quarantineArtifactVersion(
    database,
    first.versionId,
    "selected bytes failed manual inspection"
  );
  const [selectionCount] = await database<Array<{ count: number }>>`
    select count(*)::int as count from artifact_version_selection where artifact_id = ${first.artifactId}
  `;
  expect(selectionCount?.count).toBe(0);
  await expect(
    quarantineArtifactVersion(database, first.versionId, "rewrite evidence")
  ).rejects.toThrow("Artifact version must exist in verified or staged state");

  const single = await retainVersion({
    filename: "apc260712.zip",
    state: "staged",
    suffix: "single",
  });
  await insertStagedParse(single.versionId);
  await expect(selectArtifactVersion(database, single.versionId, "invalid")).rejects.toThrow(
    "Selected version is not one of multiple retained, currently parsed versions"
  );
});

test("logical artifact diagnostics distinguish unresolved and published older reissue selection", async () => {
  const older = await retainVersion({
    filename: annualGenerationV1Artifacts[0],
    product: "TRTYRAP",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    state: "staged",
    suffix: "older",
  });
  const newer = await retainVersion({
    artifactId: older.artifactId,
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    state: "staged",
    suffix: "newer",
  });
  await database`
    update artifact_discovery set observed_at = now() + interval '1 second'
    where artifact_version_id = ${newer.versionId}
  `;
  await insertStagedParse(older.versionId);
  await insertStagedParse(newer.versionId);

  expect((await readOperatorArtifacts(database, { limit: 25, offset: 0 })).items[0]).toMatchObject({
    artifactVersionId: newer.versionId,
    retainedVersionCount: 2,
    selectedArtifactVersionId: null,
    selectionRequired: true,
    stage: "staged",
  });
  await selectArtifactVersion(database, older.versionId, "older source metadata is authoritative");
  await database`update artifact_version set state = 'published' where id = ${older.versionId}`;

  expect((await readOperatorArtifacts(database, { limit: 25, offset: 0 })).items[0]).toMatchObject({
    artifactVersionId: newer.versionId,
    retainedVersionCount: 2,
    selectedArtifactVersionId: older.versionId,
    selectionRequired: false,
    stage: "published",
  });
});

test("source recovery requires and resolves the exact current stopped-lane alert set", async () => {
  await database`
    insert into source_lane (id, status, stop_reason, transient_failure_count)
    values ('uspto-odp', 'stopped', 'HTTP_403', 0)
  `;
  const alerts = [randomUUID(), randomUUID()];
  for (const [index, alertId] of alerts.entries()) {
    const attemptId = randomUUID();
    // biome-ignore lint/performance/noAwaitInLoops: Alert fixtures are inserted sequentially with dependent attempts.
    await database`
      insert into source_attempt (
        id, lane_id, kind, product_id, started_at, finished_at, outcome, error_code
      ) values (
        ${attemptId}, 'uspto-odp', 'discovery', ${index === 0 ? "TRTYRAP" : "TRTDXFAP"},
        now(), now(), 'credential_failure', 'HTTP_403'
      )
    `;
    await database`
      insert into source_alert (id, lane_id, attempt_id, kind, message, created_at)
      values (${alertId}, 'uspto-odp', ${attemptId}, 'credential', 'credential rejected', now())
    `;
  }

  expect(
    await recoverSourceLane(database, {
      reason: "credential rotated and verified",
    })
  ).toEqual({
    resolvedAlerts: 2,
  });
  const [recovered] = await database<Array<{ resolved: number; status: string }>>`
    select
      (select count(*)::int from source_alert where resolved_at is not null) as resolved,
      (select status from source_lane where id = 'uspto-odp') as status
  `;
  expect(recovered).toEqual({ resolved: 2, status: "ready" });
  await expect(recoverSourceLane(database, { reason: "again" })).rejects.toThrow(
    "Source lane is not stopped"
  );
});

test("full rebuild retires obsolete derived state, preserves quarantine and catalog, and remains resumable", async () => {
  await database`alter table artifact_version alter column object_key set not null`;
  const orphanObjectKey = "fixture/unreferenced-finalized.zip";
  const finalizedOrphans = new Set([orphanObjectKey]);
  const proofCountsDuringOrphanRemoval: number[] = [];
  const removedObjects: string[] = [];
  let activeRemovals = 0;
  let maximumActiveRemovals = 0;
  const artifactStore = {
    listObjectKeys: () => artifactObjectKeys([...finalizedOrphans]),
    remove: async (objectKey: string) => {
      activeRemovals += 1;
      maximumActiveRemovals = Math.max(maximumActiveRemovals, activeRemovals);
      if (objectKey === orphanObjectKey) {
        const [proof] = await database<Array<{ count: number }>>`
          select count(*)::int as count from prd77_cutover_proof
        `;
        proofCountsDuringOrphanRemoval.push(proof?.count ?? -1);
        finalizedOrphans.delete(objectKey);
      }
      await Promise.resolve();
      removedObjects.push(objectKey);
      activeRemovals -= 1;
    },
  };
  const retained = await retainVersion({ filename: "apc260711.zip" });
  const restoredStaged = await retainVersion({ filename: "apc260710.zip", state: "staged" });
  const restoredPublished = await retainVersion({ filename: "apc260709.zip", state: "published" });
  const quarantined = await retainVersion({ filename: "apc260708.zip", state: "quarantined" });
  const stagedV2 = await insertStagedParse(restoredStaged.versionId, "uspto-application-xml-v2");
  await insertStagedParse(restoredPublished.versionId, "uspto-application-xml-v2");
  const sourceRecordId = randomUUID();
  await database`
    insert into source_record (
      id, parse_run_id, physical_record_index, action_key, action_occurrence, action_record_index,
      serial_number, schema_version, schema_version_date, profile, digest, values
    ) values (
      ${sourceRecordId}, ${stagedV2}, 1, 'TX', 1, 1, '60146682', '2.0', '20041108',
      'annual-tx-full-v1', ${"c".repeat(64)}, ${database.json([])}
    )
  `;
  await database`
    insert into source_claim (
      id, source_record_id, claim_order, path, occurrence, presence, operation, raw_value
    ) values (
      ${randomUUID()}, ${sourceRecordId}, 1, 'case-file/case-file-header/mark-identification',
      1, 'value', 'set', 'MACHINE-PISTOL'
    )
  `;
  const quarantineRunId = randomUUID();
  await database`
    insert into parse_run (
      id, artifact_version_id, state, parser_version, digest, record_count, reject_count, started_at, finished_at
    ) values (
      ${quarantineRunId}, ${quarantined.versionId}, 'quarantined', 'uspto-application-xml-v2',
      ${"d".repeat(64)}, 0, 1, now(), now()
    )
  `;
  await database`
    insert into parse_reject (id, parse_run_id, reason, raw_xml, bytes, digest)
    values (${randomUUID()}, ${quarantineRunId}, 'invalid framing', ${Buffer.from("invalid")}, 7, ${"e".repeat(64)})
  `;
  await database`
    insert into mark (
      serial_number, registration_number, word_mark, normalization_version, source_profile_version,
      projection_version, authority_policy_version
    ) values ('60146682', '0146682', 'MACHINE-PISTOL', 'v1', 'v1', 'v1', 'v1')
  `;
  const accountId = randomUUID();
  await database`insert into account (id, name) values (${accountId}, 'cutover-owner')`;
  await database`
    insert into api_key (id, account_id, name, secret_hash, suffix)
    values (${randomUUID()}, ${accountId}, 'preserved', ${"0".repeat(64)}, '12345678')
  `;
  const tracerArtifactId = randomUUID();
  const tracerVersionId = randomUUID();
  await database`
    insert into artifact (id, product_id, filename)
    values (${tracerArtifactId}, 'TRTYRAP', 'prd-60-tracer-annual-2025-full-tx-60146682.xml')
  `;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
    values (${tracerVersionId}, ${tracerArtifactId}, ${"f".repeat(64)}, 1, 'fixture/tracer', 'staged')
  `;
  await insertStagedParse(tracerVersionId, "uspto-application-xml-v2");
  await expect(
    requestFullRebuild({ artifactStore, database, offlineConfirmed: false })
  ).rejects.toThrow("stopped-worker offline invocation");

  const first = await requestFullRebuild({ artifactStore, database, offlineConfirmed: true });
  expect(first).toMatchObject({
    artifactObjectsRemoved: 6,
    discardedQueuedReconciliations: 0,
    normalizedArtifactVersions: 3,
    orphanArtifactObjectsRemoved: 1,
    removedCanonicalMarks: 1,
    removedObsoleteParseRuns: 3,
    retainedArtifactVersions: 4,
    retiredTracerArtifactVersions: 1,
  });
  expect(first.sourceClaimBytesAfter).toBeLessThan(first.sourceClaimBytesBefore);
  expect(first.sourceRecordBytesAfter).toBeLessThan(first.sourceRecordBytesBefore);
  expect(maximumActiveRemovals).toBe(1);
  expect(removedObjects).toHaveLength(6);
  expect(removedObjects).toContain(orphanObjectKey);
  expect([...finalizedOrphans]).toEqual([]);
  expect(proofCountsDuringOrphanRemoval).toEqual([0]);
  const [cutoverProof] = await database<Array<{ count: number }>>`
    select count(*)::int as count from prd77_cutover_proof
  `;
  expect(cutoverProof?.count).toBe(1);
  const restoredStates = await database<Array<{ id: string; state: string }>>`
    select id, state from artifact_version
    where id in (${restoredStaged.versionId}, ${restoredPublished.versionId}, ${quarantined.versionId})
    order by id
  `;
  expect(new Map(restoredStates.map((version) => [version.id, version.state]))).toEqual(
    new Map([
      [restoredStaged.versionId, "verified"],
      [restoredPublished.versionId, "verified"],
      [quarantined.versionId, "quarantined"],
    ])
  );
  const [preserved] = await database<
    Array<{
      artifacts: number;
      apiKeys: number;
      discoveries: number;
      pendingDiscoveries: number;
      marks: number;
      objectKeys: number;
      obsoleteRuns: number;
      quarantineRejects: number;
      quarantineRuns: number;
      sourceClaims: number;
      sourceRecords: number;
      tracerArtifacts: number;
      tracerVersions: number;
      versions: number;
    }>
  >`
    select
      (select count(*)::int from artifact) as artifacts,
      (select count(*)::int from api_key where account_id = ${accountId}) as "apiKeys",
      (select count(*)::int from artifact_discovery) as discoveries,
      (select count(*)::int from artifact_discovery where download_state = 'pending' and artifact_version_id is null) as "pendingDiscoveries",
      (select count(*)::int from mark) as marks,
      (select count(*)::int from artifact_version where object_key is not null) as "objectKeys",
      (select count(*)::int from parse_run where state <> 'quarantined' and parser_version <> ${sourceObservationParserVersion}) as "obsoleteRuns",
      (select count(*)::int from parse_reject where parse_run_id = ${quarantineRunId}) as "quarantineRejects",
      (select count(*)::int from parse_run where id = ${quarantineRunId}) as "quarantineRuns",
      (select count(*)::int from source_claim) as "sourceClaims",
      (select count(*)::int from source_record) as "sourceRecords",
      (select count(*)::int from artifact where id = ${tracerArtifactId}) as "tracerArtifacts",
      (select count(*)::int from artifact_version where id = ${tracerVersionId}) as "tracerVersions",
      (select count(*)::int from artifact_version) as versions
  `;
  expect(preserved).toEqual({
    apiKeys: 1,
    artifacts: 4,
    discoveries: 4,
    marks: 0,
    objectKeys: 4,
    obsoleteRuns: 0,
    pendingDiscoveries: 4,
    quarantineRejects: 1,
    quarantineRuns: 1,
    sourceClaims: 0,
    sourceRecords: 0,
    tracerArtifacts: 0,
    tracerVersions: 0,
    versions: 4,
  });
  await insertStagedParse(retained.versionId);
  await database`update artifact_version set state = 'staged' where id = ${retained.versionId}`;

  const resumed = await requestFullRebuild({ artifactStore, database, offlineConfirmed: true });
  expect(resumed).toMatchObject({
    artifactObjectsRemoved: 4,
    normalizedArtifactVersions: 1,
    orphanArtifactObjectsRemoved: 0,
    removedCanonicalMarks: 0,
    removedObsoleteParseRuns: 1,
    retainedArtifactVersions: 4,
    retiredTracerArtifactVersions: 0,
  });
  await database`
    insert into publication (
      id, fingerprint, source_fingerprint, parser_version, authority_policy_version, projection_version,
      normalization_version, source_profile_version, artifact_count
    ) values (
      ${randomUUID()}, ${"a".repeat(64)}, ${"b".repeat(64)}, 'parser', 'authority', 'projection',
      'normalization', 'profile', 0
    )
  `;
  await expect(
    requestFullRebuild({ artifactStore, database, offlineConfirmed: true })
  ).rejects.toThrow("no durable corpus or publication");
});

test("offline rebuild re-downloads one existing SHA, parses once, and releases its raw object", async () => {
  await database`alter table artifact_version alter column object_key set not null`;
  const retained = await retainVersion({ filename: "apc260715.zip" });
  const sha256 = createHash("sha256").update(emptyXml).digest("hex");
  const objectKey = `sha256/${sha256.slice(0, 2)}/${sha256}`;
  await database`
    update artifact_version set sha256 = ${sha256}, bytes = ${emptyXml.byteLength}, object_key = ${objectKey}
    where id = ${retained.versionId}
  `;
  await database`
    update dataset_product set next_discovery_at = '2099-01-01T00:00:00Z'
  `;
  let rawPresent = true;
  const removed: string[] = [];
  const artifactStore: ArtifactStore = {
    head: () => Promise.resolve(rawPresent ? { bytes: emptyXml.byteLength } : null),
    listObjectKeys: () => artifactObjectKeys(rawPresent ? [objectKey] : []),
    openFile: () => {
      if (!rawPresent) {
        return Promise.reject(new Error("raw object is absent"));
      }
      return Promise.resolve(objectKey);
    },
    put: async (body) => {
      const bytes = Buffer.from(await new Response(body).arrayBuffer());
      rawPresent = true;
      return {
        bytes: bytes.byteLength,
        objectKey,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
    remove: (removedObjectKey) => {
      removed.push(removedObjectKey);
      rawPresent = false;
      return Promise.resolve();
    },
  };

  await requestFullRebuild({ artifactStore, database, offlineConfirmed: true });
  const [reset] = await database<Array<{ downloadState: string; objectKey: string | null }>>`
    select discovery.download_state as "downloadState", version.object_key as "objectKey"
    from artifact_discovery discovery
    join artifact_version version on version.artifact_id = discovery.artifact_id
    where version.id = ${retained.versionId}
  `;
  expect(reset).toEqual({ downloadState: "pending", objectKey });
  await database`alter table artifact_version alter column object_key drop not null`;
  await database`update artifact_version set object_key = null`;

  const scheduler = createArtifactScheduler({
    artifactStore,
    database,
    discoveryIntervalMs: 60_000,
    products: ["TRTDXFAP"],
    sourceCatalog: {
      discover: () => Promise.reject(new Error("discovery is not due")),
      download: async () => ({
        body: new Blob([emptyXml]).stream(),
        expectedBytes: emptyXml.byteLength,
        responseState: { status: 200 },
      }),
    },
  });
  expect(await scheduler.runOnce()).toMatchObject({
    action: "download",
    versionCreated: false,
  });
  const [redownloaded] = await database<Array<{ objectKey: string | null }>>`
    select object_key as "objectKey" from artifact_version where id = ${retained.versionId}
  `;
  expect(redownloaded?.objectKey).toBe(objectKey);

  const reconciler = createIngestionReconciler({
    artifactScheduler: scheduler,
    artifactStore,
    database,
    extractXml: () => new Blob([emptyXml]).stream(),
  });
  expect(await reconciler.reconcile()).toMatchObject({
    action: "parse",
    artifactVersionId: retained.versionId,
  });
  const [parsed] = await database<Array<{ objectKey: string | null; runs: number }>>`
    select version.object_key as "objectKey",
      (select count(*)::int from parse_run where artifact_version_id = version.id) as runs
    from artifact_version version where id = ${retained.versionId}
  `;
  expect(parsed).toEqual({ objectKey: null, runs: 1 });
  expect(removed).toEqual([objectKey, objectKey]);
});

test("offline rebuild downloads one pinned annual member before older daily work", async () => {
  await database`alter table artifact_version alter column object_key set not null`;
  const daily = await retainVersion({ filename: "apc240925.zip" });
  const [annualFilename] = annualGenerationV1Artifacts;
  if (!annualFilename) {
    throw new Error("Expected the pinned annual publication policy");
  }
  const annual = await retainVersion({
    filename: annualFilename,
    product: "TRTYRAP",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
  });
  await database`
    update artifact_discovery
    set release_date = '2024-09-26', download_url = 'https://example.test/apc240925.zip'
    where artifact_id = ${daily.artifactId}
  `;
  await database`
    update artifact_discovery
    set release_date = '2026-01-01', download_url = ${`https://example.test/${annualFilename}`}
    where artifact_id = ${annual.artifactId}
  `;
  await requestFullRebuild({
    artifactStore: { listObjectKeys: artifactObjectKeys, remove: () => Promise.resolve() },
    database,
    offlineConfirmed: true,
  });
  await database`alter table artifact_version alter column object_key drop not null`;
  await database`update artifact_version set object_key = null`;
  await database`
    update dataset_product set next_discovery_at = '2099-01-01T00:00:00Z'
  `;
  const downloaded: string[] = [];
  const scheduler = createArtifactScheduler({
    artifactStore: {
      head: () => Promise.resolve(null),
      listObjectKeys: artifactObjectKeys,
      openFile: () => Promise.reject(new Error("parse is outside this test")),
      put: async (body) => {
        const bytes = Buffer.from(await new Response(body).arrayBuffer());
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        return {
          bytes: bytes.byteLength,
          objectKey: `sha256/${sha256.slice(0, 2)}/${sha256}`,
          sha256,
        };
      },
      remove: () => Promise.resolve(),
    },
    database,
    discoveryIntervalMs: 60_000,
    products: ["TRTDXFAP", "TRTYRAP"],
    sourceCatalog: {
      discover: () => Promise.reject(new Error("discovery is not due")),
      download: (url) => {
        downloaded.push(url);
        return Promise.resolve({
          body: new Blob([emptyXml]).stream(),
          expectedBytes: emptyXml.byteLength,
          responseState: { status: 200 },
        });
      },
    },
  });

  expect(await scheduler.runOnce()).toMatchObject({ action: "download", filename: annualFilename });
  expect(downloaded).toHaveLength(1);
  expect(downloaded[0]).toContain(annualFilename);
});
