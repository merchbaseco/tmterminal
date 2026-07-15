import { createHash, randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "bun:test";
import postgres from "postgres";

import { migrateDatabase, migrateSchedulerDatabase } from "../../src/db/migrate.ts";
import { quarantineArtifactVersion } from "../../src/ingestion/artifact-quarantine.ts";
import {
  recoverSourceLane,
  replayArtifactVersion,
  requestFullRebuild,
  selectArtifactVersion,
} from "../../src/ingestion/sync-operations.ts";
import { sourceObservationParserVersion } from "../../src/ingestion/source-observations.ts";
import { readOperatorArtifacts } from "../../src/queries/operator-sync-repository.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
const database = postgres(databaseUrl, { max: 2, prepare: false });

const emptyXml = Buffer.from(
  "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202607150000</creation-datetime><application-information><data-available-code>N</data-available-code></application-information></trademark-applications-daily>",
);

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  await migrateSchedulerDatabase(databaseUrl);
  await database`insert into dataset_product (id) values ('TRTDXFAP'), ('TRTYRAP')`;
});

async function retainVersion(input: {
  artifactId?: string;
  filename?: string;
  state?: "parsing" | "published" | "quarantined" | "staged" | "verified";
  suffix?: string;
}) {
  const artifactId = input.artifactId ?? randomUUID();
  const versionId = randomUUID();
  const suffix = input.suffix ?? randomUUID();
  if (!input.artifactId) {
    await database`
      insert into artifact (id, product_id, filename)
      values (${artifactId}, 'TRTDXFAP', ${input.filename ?? `${artifactId}.zip`})
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
      now(), 'verified', 'https://example.test/source.zip', ${emptyXml.byteLength}, current_date, current_date,
      current_date, now()
    )
  `;
  return { artifactId, versionId };
}

async function insertStagedParse(versionId: string, parserVersion = sourceObservationParserVersion) {
  await database`
    insert into parse_run (
      id, artifact_version_id, state, parser_version, digest, record_count, reject_count, started_at, finished_at
    ) values (
      ${randomUUID()}, ${versionId}, 'staged', ${parserVersion}, ${createHash("sha256").update(versionId).digest("hex")},
      0, 0, now(), now()
    )
  `;
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
    "Artifact version must exist in verified or staged state",
  );
});

test("parser replay creates only the missing current-parser run", async () => {
  const retained = await retainVersion({ filename: "apc260714.zip" });
  await insertStagedParse(retained.versionId, "uspto-application-xml-v1");
  const artifactStore = { get: async () => new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(emptyXml); controller.close(); },
  }) };

  await replayArtifactVersion({
    artifactStore,
    artifactVersionId: retained.versionId,
    database,
    extractXml: (archive) => archive,
  });
  const [runs] = await database<Array<{ count: number }>>`
    select count(*)::int as count from parse_run
    where artifact_version_id = ${retained.versionId} and parser_version = ${sourceObservationParserVersion}
  `;
  expect(runs?.count).toBe(1);
  await expect(replayArtifactVersion({
    artifactStore,
    artifactVersionId: retained.versionId,
    database,
    extractXml: (archive) => archive,
  })).rejects.toThrow("Artifact version already has a run for the current parser");
});

test("parser replay cannot resurrect quarantined evidence", async () => {
  const retained = await retainVersion({ filename: "apc260714.zip" });
  const reason = "Operator quarantined retained evidence before parser replay";
  await quarantineArtifactVersion(database, retained.versionId, reason);
  const artifactStore = { get: async () => new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(emptyXml); controller.close(); },
  }) };

  await expect(replayArtifactVersion({
    artifactStore,
    artifactVersionId: retained.versionId,
    database,
    extractXml: (archive) => archive,
  })).rejects.toThrow("Artifact version must be verified, staged, or published to parse");
  const [version] = await database<Array<{ quarantineReason: string; state: string }>>`
    select state, quarantine_reason as "quarantineReason"
    from artifact_version where id = ${retained.versionId}
  `;
  const [parseRuns] = await database<Array<{ count: number }>>`
    select count(*)::int as count from parse_run where artifact_version_id = ${retained.versionId}
  `;
  expect(version).toEqual({ quarantineReason: reason, state: "quarantined" });
  expect(parseRuns?.count).toBe(0);
});

test("reissue selection is exact, and quarantine invalidates its selected staged version", async () => {
  const first = await retainVersion({ filename: "apc260713.zip", state: "staged", suffix: "first" });
  const second = await retainVersion({ artifactId: first.artifactId, state: "staged", suffix: "second" });
  await insertStagedParse(first.versionId);
  await insertStagedParse(second.versionId);

  await selectArtifactVersion(database, first.versionId, "Selected after comparing retained source metadata");
  const [selection] = await database<Array<{ artifactVersionId: string; reason: string }>>`
    select artifact_version_id as "artifactVersionId", reason from artifact_version_selection
    where artifact_id = ${first.artifactId}
  `;
  expect(selection).toEqual({
    artifactVersionId: first.versionId,
    reason: "Selected after comparing retained source metadata",
  });
  await quarantineArtifactVersion(database, first.versionId, "selected bytes failed manual inspection");
  const [selectionCount] = await database<Array<{ count: number }>>`
    select count(*)::int as count from artifact_version_selection where artifact_id = ${first.artifactId}
  `;
  expect(selectionCount?.count).toBe(0);
  await expect(quarantineArtifactVersion(database, first.versionId, "rewrite evidence")).rejects.toThrow(
    "Artifact version must exist in verified or staged state",
  );

  const single = await retainVersion({ filename: "apc260712.zip", state: "staged", suffix: "single" });
  await insertStagedParse(single.versionId);
  await expect(selectArtifactVersion(database, single.versionId, "invalid")).rejects.toThrow(
    "Selected version is not one of multiple retained, currently parsed versions",
  );
});

test("logical artifact diagnostics distinguish unresolved and published older reissue selection", async () => {
  const older = await retainVersion({ filename: "apc260712.zip", state: "staged", suffix: "older" });
  const newer = await retainVersion({ artifactId: older.artifactId, state: "staged", suffix: "newer" });
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

  expect(await recoverSourceLane(database, {
    reason: "credential rotated and verified",
  })).toEqual({
    resolvedAlerts: 2,
  });
  const [recovered] = await database<Array<{ resolved: number; status: string }>>`
    select
      (select count(*)::int from source_alert where resolved_at is not null) as resolved,
      (select status from source_lane where id = 'uspto-odp') as status
  `;
  expect(recovered).toEqual({ resolved: 2, status: "ready" });
  await expect(recoverSourceLane(database, { reason: "again" })).rejects.toThrow(
    "Source lane is not stopped",
  );
});

test("full rebuild preflight wakes the one reconciler and remains resumable after partial parsing", async () => {
  const retained = await retainVersion({ filename: "apc260711.zip" });
  const restoredStaged = await retainVersion({ filename: "apc260710.zip", state: "staged" });
  const restoredPublished = await retainVersion({ filename: "apc260709.zip", state: "published" });
  const quarantined = await retainVersion({ filename: "apc260708.zip", state: "quarantined" });
  await expect(requestFullRebuild({ database, databaseUrl, offlineConfirmed: false })).rejects.toThrow(
    "stopped-worker offline invocation",
  );

  const first = await requestFullRebuild({ database, databaseUrl, offlineConfirmed: true });
  expect(first).toMatchObject({
    normalizedArtifactVersions: 2,
    retainedArtifactVersions: 4,
  });
  expect(first.jobId).toBeString();
  const restoredStates = await database<Array<{ id: string; state: string }>>`
    select id, state from artifact_version
    where id in (${restoredStaged.versionId}, ${restoredPublished.versionId}, ${quarantined.versionId})
    order by id
  `;
  expect(new Map(restoredStates.map((version) => [version.id, version.state]))).toEqual(new Map([
    [restoredStaged.versionId, "verified"],
    [restoredPublished.versionId, "verified"],
    [quarantined.versionId, "quarantined"],
  ]));
  await database`
    update pgboss.job set state = 'completed', completed_on = now()
    where id = ${first.jobId}
  `;
  await insertStagedParse(retained.versionId);
  await database`update artifact_version set state = 'staged' where id = ${retained.versionId}`;

  const resumed = await requestFullRebuild({ database, databaseUrl, offlineConfirmed: true });
  expect(resumed).toMatchObject({
    normalizedArtifactVersions: 0,
    retainedArtifactVersions: 4,
  });
  expect(resumed.jobId).toBeString();
  expect(resumed.jobId).not.toBe(first.jobId);
  await database`
    update pgboss.job set state = 'completed', completed_on = now()
    where id = ${resumed.jobId}
  `;
  await database`
    insert into publication (
      id, fingerprint, source_fingerprint, parser_version, authority_policy_version, projection_version,
      normalization_version, source_profile_version, artifact_count
    ) values (
      ${randomUUID()}, ${"a".repeat(64)}, ${"b".repeat(64)}, 'parser', 'authority', 'projection',
      'normalization', 'profile', 0
    )
  `;
  await expect(requestFullRebuild({ database, databaseUrl, offlineConfirmed: true })).rejects.toThrow(
    "empty canonical and publication target",
  );
});
