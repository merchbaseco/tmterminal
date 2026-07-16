import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { annualGenerationV1Artifacts } from "../../src/ingestion/annual-generation-v1.ts";
import { sourceObservationParserVersion } from "../../src/ingestion/source-observations.ts";
import { reprocessArtifactVersion } from "../../src/ingestion/sync-operations.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}
const database = postgres(databaseUrl, { max: 2, prepare: false });
const parserV3 = "uspto-application-xml-v3";

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  await database`insert into dataset_product (id) values ('TRTYRAP')`;
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

async function retainTerminalV3(state: "quarantined" | "staged") {
  const artifactId = randomUUID();
  const artifactVersionId = randomUUID();
  const discoveryId = randomUUID();
  const parseRunId = randomUUID();
  const sha256 = createHash("sha256").update(`${state}-artifact`).digest("hex");
  const parseDigest = createHash("sha256").update(`${state}-parse`).digest("hex");
  await database`
    insert into artifact (id, product_id, filename)
    values (${artifactId}, 'TRTYRAP', ${annualGenerationV1Artifacts[0]})
  `;
  await database`
    insert into artifact_version (
      id, artifact_id, sha256, bytes, object_key, state, quarantined_at, quarantine_reason
    ) values (
      ${artifactVersionId}, ${artifactId}, ${sha256}, 100, null, ${state},
      ${state === "quarantined" ? new Date("2026-07-16T12:00:00Z") : null},
      ${state === "quarantined" ? "record exceeds 524288 byte limit" : null}
    )
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state,
      download_url, expected_bytes, source_from_date, source_to_date, release_date,
      source_last_modified_at
    ) values (
      ${discoveryId}, ${artifactId}, ${artifactVersionId},
      ${createHash("sha256").update(`${state}-discovery`).digest("hex")},
      '2026-04-03T10:03:07Z', 'verified', 'https://example.test/annual.zip', 100,
      '1884-04-07', '2025-12-31', '2026-04-03', '2026-04-03T10:03:07Z'
    )
  `;
  await database`
    insert into parse_run (
      id, artifact_version_id, state, parser_version, digest, record_count, reject_count,
      started_at, finished_at
    ) values (
      ${parseRunId}, ${artifactVersionId}, ${state}, ${parserV3}, ${parseDigest},
      ${state === "staged" ? 1 : 0}, ${state === "quarantined" ? 1 : 0},
      '2026-07-16T12:00:00Z', '2026-07-16T12:01:00Z'
    )
  `;
  if (state === "staged") {
    await database`
      insert into source_record (
        id, parse_run_id, physical_record_index, action_key, action_occurrence,
        action_record_index, serial_number, schema_version, schema_version_date,
        profile, digest, values
      ) values (
        ${randomUUID()}, ${parseRunId}, 1, 'TX', 1, 1, '74668071', '2.0', '20041108',
        'annual-tx-full-v1', ${createHash("sha256").update("source-record").digest("hex")}, '[]'
      )
    `;
  } else {
    await database`
      insert into parse_reject (
        id, parse_run_id, reason, raw_xml, bytes, digest, physical_record_index
      ) values (
        ${randomUUID()}, ${parseRunId}, 'record exceeds 524288 byte limit',
        ${Buffer.from("bounded v3 reject")}, 17,
        ${createHash("sha256").update("bounded v3 reject").digest("hex")}, 1107
      )
    `;
  }
  return { artifactId, artifactVersionId, discoveryId, parseDigest, parseRunId, sha256, state };
}

async function readRecoveryState(artifactVersionId: string) {
  const [state] = await database<
    Array<{
      artifactVersionId: string | null;
      downloadState: string;
      objectKey: string | null;
      quarantineReason: string | null;
      state: string;
    }>
  >`
    select discovery.artifact_version_id as "artifactVersionId",
      discovery.download_state as "downloadState", version.object_key as "objectKey",
      version.quarantine_reason as "quarantineReason", version.state
    from artifact_version version
    join artifact_discovery discovery on discovery.artifact_id = version.artifact_id
    where version.id = ${artifactVersionId}
    order by discovery.observed_at desc, discovery.id desc
    limit 1
  `;
  return state;
}

test("reprocesses one staged v3 annual version while preserving its observations", async () => {
  const retained = await retainTerminalV3("staged");

  const result = await reprocessArtifactVersion(
    database,
    retained.artifactVersionId,
    "Re-download for parser v4"
  );

  expect(result).toEqual({
    artifactId: retained.artifactId,
    artifactVersionId: retained.artifactVersionId,
    discoveryId: retained.discoveryId,
    filename: annualGenerationV1Artifacts[0],
    previousState: "staged",
    product: "TRTYRAP",
    reason: "Re-download for parser v4",
    sha256: retained.sha256,
  });
  expect(await readRecoveryState(retained.artifactVersionId)).toEqual({
    artifactVersionId: null,
    downloadState: "pending",
    objectKey: null,
    quarantineReason: null,
    state: "verified",
  });
  const [evidence] = await database<Array<{ digest: string; records: number }>>`
    select run.digest, count(record.id)::int as records
    from parse_run run
    left join source_record record on record.parse_run_id = run.id
    where run.id = ${retained.parseRunId}
    group by run.id
  `;
  expect(evidence).toEqual({ digest: retained.parseDigest, records: 1 });
});

test("reprocesses one quarantined v3 annual version while preserving its reject", async () => {
  const retained = await retainTerminalV3("quarantined");
  const [before] = await database<Array<{ bytes: number; digest: string; rawXml: Buffer }>>`
    select bytes, digest, raw_xml as "rawXml" from parse_reject
    where parse_run_id = ${retained.parseRunId}
  `;

  const result = await reprocessArtifactVersion(
    database,
    retained.artifactVersionId,
    "Authentic record exceeds parser v3 bound"
  );

  expect(result).toMatchObject({
    artifactVersionId: retained.artifactVersionId,
    discoveryId: retained.discoveryId,
    previousState: "quarantined",
  });
  expect(await readRecoveryState(retained.artifactVersionId)).toMatchObject({
    artifactVersionId: null,
    downloadState: "pending",
    quarantineReason: null,
    state: "verified",
  });
  const [after] = await database<Array<{ bytes: number; digest: string; rawXml: Buffer }>>`
    select bytes, digest, raw_xml as "rawXml" from parse_reject
    where parse_run_id = ${retained.parseRunId}
  `;
  expect(after).toEqual(before);
});

test("refuses an already-published annual member without mutation", async () => {
  const retained = await retainTerminalV3("staged");
  const publicationId = randomUUID();
  await database`
    insert into publication (
      id, fingerprint, source_fingerprint, parser_version, authority_policy_version,
      projection_version, normalization_version, source_profile_version, state,
      artifact_count, published_at
    ) values (
      ${publicationId}, ${"a".repeat(64)}, ${"b".repeat(64)}, ${parserV3}, 'v1', 'v1',
      'v1', 'v1', 'published', 1, now()
    )
  `;
  await database`
    insert into publication_artifact (
      publication_id, artifact_id, discovery_id, artifact_version_id,
      artifact_version_sha256, parse_run_id, parse_run_digest,
      retained_version_fingerprint, source_from_date, source_to_date
    ) values (
      ${publicationId}, ${retained.artifactId}, ${retained.discoveryId},
      ${retained.artifactVersionId}, ${retained.sha256}, ${retained.parseRunId},
      ${retained.parseDigest}, ${retained.sha256}, '1884-04-07', '2025-12-31'
    )
  `;
  await database`
    insert into corpus_state (id, corpus_version, publication_id)
    values ('uspto', 1, ${publicationId})
  `;
  const before = await readRecoveryState(retained.artifactVersionId);

  await expect(
    reprocessArtifactVersion(database, retained.artifactVersionId, "must refuse")
  ).rejects.toThrow("unpublished first annual corpus");

  expect(await readRecoveryState(retained.artifactVersionId)).toEqual(before);
});

test("refuses a stale discovery or existing v4 run without mutation", async () => {
  const stale = await retainTerminalV3("staged");
  await database`
    insert into artifact_discovery (
      id, artifact_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${stale.artifactId}, ${"c".repeat(64)}, '2026-04-04T10:03:07Z',
      'pending', 'https://example.test/reissue.zip', 101, '1884-04-07', '2025-12-31',
      '2026-04-04', '2026-04-04T10:03:07Z'
    )
  `;
  const staleBefore = await readRecoveryState(stale.artifactVersionId);
  await expect(
    reprocessArtifactVersion(database, stale.artifactVersionId, "must refuse stale")
  ).rejects.toThrow("latest verified discovery");
  expect(await readRecoveryState(stale.artifactVersionId)).toEqual(staleBefore);

  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  await database`insert into dataset_product (id) values ('TRTYRAP')`;
  const current = await retainTerminalV3("staged");
  await database`
    insert into parse_run (
      id, artifact_version_id, state, parser_version, digest, finished_at
    ) values (
      ${randomUUID()}, ${current.artifactVersionId}, 'staged',
      ${sourceObservationParserVersion}, ${"d".repeat(64)}, now()
    )
  `;
  const currentBefore = await readRecoveryState(current.artifactVersionId);
  await expect(
    reprocessArtifactVersion(database, current.artifactVersionId, "must refuse v4")
  ).rejects.toThrow("current parser run");
  expect(await readRecoveryState(current.artifactVersionId)).toEqual(currentBefore);
});
