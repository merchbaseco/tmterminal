import type postgres from "postgres";

import { lockCorpusPublication } from "../queries/corpus-publication-lock.ts";
import type { ArtifactStore } from "./artifact-store.ts";
import { retainedVersionFingerprint } from "./artifact-version-selection.ts";
import { createCorpusPublisher } from "./corpus-publisher.ts";
import { reconcileQueue } from "./ingestion-scheduler.ts";
import { isPublicationPolicyArtifact } from "./publication-policy.ts";
import { sourceObservationParserVersion } from "./source-observations.ts";

const retiredTracerFilename = "prd-60-tracer-annual-2025-full-tx-60146682.xml";
const prd77CutoverProof = "artifact-lifecycle-v1";

export function selectArtifactVersion(
  database: postgres.Sql,
  artifactVersionId: string,
  reason: string
) {
  return database.begin(async (transaction) => {
    await lockCorpusPublication(transaction);
    const [version] = await transaction<
      Array<{
        artifactId: string;
        filename: string;
        product: string;
        sha256s: string[];
        sourceFromDate: string;
        sourceToDate: string;
      }>
    >`
      select selected.artifact_id as "artifactId", artifact.filename, artifact.product_id as product,
        retained.sha256s, discovery.source_from_date::text as "sourceFromDate",
        discovery.source_to_date::text as "sourceToDate"
      from artifact_version selected
      join artifact on artifact.id = selected.artifact_id
      join lateral (
        select count(*)::int as count, array_agg(sha256 order by sha256) as sha256s
        from artifact_version where artifact_id = selected.artifact_id
      ) retained on retained.count > 1
      join lateral (
        select source_from_date, source_to_date
        from artifact_discovery
        where artifact_id = selected.artifact_id
          and artifact_version_id = selected.id
          and download_state = 'verified'
        order by observed_at desc, id desc
        limit 1
      ) discovery on true
      join parse_run run on run.artifact_version_id = selected.id
        and run.parser_version = ${sourceObservationParserVersion} and run.state = 'staged'
      where selected.id = ${artifactVersionId} and selected.state in ('staged', 'published')
    `;
    if (!version) {
      throw new Error(
        "Selected version is not one of multiple retained, currently parsed versions"
      );
    }
    if (!isPublicationPolicyArtifact(version)) {
      throw new Error("Selected version is outside the current publication policy");
    }
    const fingerprint = retainedVersionFingerprint(version.sha256s);
    await transaction`
      insert into artifact_version_selection (
        artifact_id, artifact_version_id, retained_version_count, retained_version_fingerprint, reason
      ) values (
        ${version.artifactId}, ${artifactVersionId}, ${version.sha256s.length}, ${fingerprint}, ${reason}
      )
      on conflict (artifact_id) do update set
        artifact_version_id = excluded.artifact_version_id,
        retained_version_count = excluded.retained_version_count,
        retained_version_fingerprint = excluded.retained_version_fingerprint,
        reason = excluded.reason,
        selected_at = now()
    `;
    return { artifactId: version.artifactId, artifactVersionId };
  });
}

export async function recoverSourceLane(database: postgres.Sql, input: { reason: string }) {
  const reserved = await database.reserve();
  try {
    await reserved`select pg_advisory_lock(hashtext('uspto-odp'))`;
    await reserved`begin`;
    const [lane] = await reserved<Array<{ status: string }>>`
      select status from source_lane where id = 'uspto-odp' for update
    `;
    if (lane?.status !== "stopped") {
      throw new Error("Source lane is not stopped");
    }
    const alerts = await reserved<Array<{ id: string }>>`
      select id from source_alert
      where lane_id = 'uspto-odp' and resolved_at is null
      order by id
      for update
    `;
    if (alerts.length === 0) {
      throw new Error("Source recovery requires current unresolved alerts");
    }
    await reserved`
      update source_lane set status = 'ready', next_eligible_at = null, transient_failure_count = 0,
        stop_reason = null, updated_at = now()
      where id = 'uspto-odp'
    `;
    await reserved`
      update source_alert set resolved_at = now(), resolution_reason = ${input.reason}
      where id in ${reserved(alerts.map((alert) => alert.id))}
    `;
    await reserved`commit`;
    return { resolvedAlerts: alerts.length };
  } catch (error) {
    await reserved`rollback`;
    throw error;
  } finally {
    await reserved`select pg_advisory_unlock(hashtext('uspto-odp'))`;
    reserved.release();
  }
}

export async function recoverCorpusFrontier(database: postgres.Sql) {
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status === "ineligible") {
    throw new Error(`Corpus frontier recovery is ineligible: ${candidate.reason}`);
  }
  if (candidate.status === "rejected") {
    throw new Error("Corpus frontier recovery selected a rejected publication");
  }
  return publisher.publish(candidate.candidateId);
}

export async function requestFullRebuild(options: {
  artifactStore: Pick<ArtifactStore, "listObjectKeys" | "remove">;
  database: postgres.Sql;
  offlineConfirmed: boolean;
}) {
  if (!options.offlineConfirmed) {
    throw new Error("Full rebuild requires the stopped-worker offline invocation");
  }
  const state = await options.database.begin(async (transaction) => {
    await lockCorpusPublication(transaction);
    const [current] = await transaction<
      [
        {
          activeJobs: number;
          canonical: number;
          corpusStates: number;
          publications: number;
          objectKeyNullable: boolean;
          sourceClaimBytes: string;
          sourceRecordBytes: string;
        },
      ]
    >`
      select
        (select count(*)::int from pgboss.job where name = ${reconcileQueue} and state in ('created', 'retry', 'active')) as "activeJobs",
        (select count(*)::int from mark) as canonical,
        (select count(*)::int from corpus_state) as "corpusStates",
        (select count(*)::int from publication) as publications,
        (select is_nullable = 'YES' from information_schema.columns
          where table_schema = 'public' and table_name = 'artifact_version'
            and column_name = 'object_key') as "objectKeyNullable",
        pg_total_relation_size('source_claim')::text as "sourceClaimBytes",
        pg_total_relation_size('source_record')::text as "sourceRecordBytes"
    `;
    if (current.corpusStates > 0 || current.publications > 0) {
      throw new Error("Full rebuild requires no durable corpus or publication");
    }
    const [catalog] = await transaction<[{ retained: number }]>`
      select count(*)::int as retained from artifact_version
    `;
    if (catalog.retained === 0) {
      throw new Error("Full rebuild target has no retained artifact catalog");
    }
    if (current.activeJobs > 0) {
      throw new Error("Full rebuild target already has outstanding reconciliation delivery");
    }
    if (current.objectKeyNullable) {
      throw new Error("Full rebuild requires the pre-object-lifecycle migration schema");
    }
    await transaction.unsafe(`
      create table if not exists prd77_cutover_proof (
        proof text primary key,
        completed_at timestamptz not null
      )
    `);
    await transaction`delete from prd77_cutover_proof`;
    await transaction.unsafe("truncate table source_claim, source_record, mark cascade");
    await transaction`
      delete from parse_reject reject
      using parse_run run
      where reject.parse_run_id = run.id and run.state <> 'quarantined'
    `;
    const removedRuns = await transaction<Array<{ id: string }>>`
      delete from parse_run where state <> 'quarantined'
      returning id
    `;
    await transaction`
      delete from artifact_version_selection
    `;
    await transaction`
      update artifact_discovery
      set artifact_version_id = null, download_state = 'pending'
    `;
    const normalized = await transaction<Array<{ id: string }>>`
      update artifact_version set state = 'verified', quarantined_at = null, quarantine_reason = null
      where state not in ('verified', 'quarantined')
      returning id
    `;
    const [after] = await transaction<[{ sourceClaimBytes: string; sourceRecordBytes: string }]>`
      select pg_total_relation_size('source_claim')::text as "sourceClaimBytes",
        pg_total_relation_size('source_record')::text as "sourceRecordBytes"
    `;
    return {
      normalizedArtifactVersions: normalized.length,
      removedCanonicalMarks: current.canonical,
      removedObsoleteParseRuns: removedRuns.length,
      retainedArtifactVersions: catalog.retained,
      sourceClaimBytesAfter: Number(after.sourceClaimBytes),
      sourceClaimBytesBefore: Number(current.sourceClaimBytes),
      sourceRecordBytesAfter: Number(after.sourceRecordBytes),
      sourceRecordBytesBefore: Number(current.sourceRecordBytes),
    };
  });

  let artifactObjectsRemoved = 0;
  let artifactBytesRemoved = 0;
  let cursor = "";
  // biome-ignore lint/suspicious/noUnnecessaryConditions: The absent keyset row terminates the cutover scan.
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: The cutover intentionally reads one object identity at a time.
    const [artifact] = await options.database<Array<{ bytes: string; objectKey: string }>>`
      select max(bytes)::text as bytes, object_key as "objectKey"
      from artifact_version
      where object_key > ${cursor}
      group by object_key
      order by object_key
      limit 1
    `;
    if (!artifact) {
      break;
    }
    await options.artifactStore.remove(artifact.objectKey);
    artifactObjectsRemoved += 1;
    artifactBytesRemoved += Number(artifact.bytes);
    cursor = artifact.objectKey;
  }

  let orphanArtifactObjectsRemoved = 0;
  for await (const objectKey of options.artifactStore.listObjectKeys()) {
    await options.artifactStore.remove(objectKey);
    artifactObjectsRemoved += 1;
    orphanArtifactObjectsRemoved += 1;
  }

  const retiredTracerArtifactVersions = await options.database.begin(async (transaction) => {
    await lockCorpusPublication(transaction);
    const versions = await transaction<Array<{ id: string }>>`
      delete from artifact_version version
      using artifact
      where version.artifact_id = artifact.id
        and artifact.product_id = 'TRTYRAP'
        and artifact.filename = ${retiredTracerFilename}
      returning version.id
    `;
    await transaction`
      delete from artifact
      where product_id = 'TRTYRAP' and filename = ${retiredTracerFilename}
    `;
    await transaction`
      insert into prd77_cutover_proof (proof, completed_at)
      values (${prd77CutoverProof}, now())
    `;
    return versions.length;
  });

  return {
    ...state,
    artifactBytesRemoved,
    artifactObjectsRemoved,
    orphanArtifactObjectsRemoved,
    retainedArtifactVersions: state.retainedArtifactVersions - retiredTracerArtifactVersions,
    retiredTracerArtifactVersions,
  };
}
