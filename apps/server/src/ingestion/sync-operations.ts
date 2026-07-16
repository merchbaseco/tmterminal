import { PgBoss } from "pg-boss";
import type postgres from "postgres";

import { lockCorpusPublication } from "../queries/corpus-publication-lock.ts";
import type { ArtifactStore } from "./artifact-store.ts";
import { retainedVersionFingerprint } from "./artifact-version-selection.ts";
import { createCorpusPublisher } from "./corpus-publisher.ts";
import { reconcileQueue, reconcileQueueOptions } from "./ingestion-scheduler.ts";
import { isPublicationPolicyArtifact } from "./publication-policy.ts";
import {
  createSourceObservationModule,
  sourceObservationParserVersion,
} from "./source-observations.ts";

const retiredTracerFilename = "prd-60-tracer-annual-2025-full-tx-60146682.xml";

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

export async function replayArtifactVersion(options: {
  artifactStore: Pick<ArtifactStore, "get">;
  artifactVersionId: string;
  database: postgres.Sql;
  extractXml: (archive: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}) {
  const [version] = await options.database<Array<{ objectKey: string; parsed: boolean }>>`
    select version.object_key as "objectKey", exists (
      select 1 from parse_run where artifact_version_id = version.id
        and parser_version = ${sourceObservationParserVersion}
    ) as parsed
    from artifact_version version where version.id = ${options.artifactVersionId}
  `;
  if (!version) {
    throw new Error("Artifact version not found");
  }
  if (version.parsed) {
    throw new Error("Artifact version already has a run for the current parser");
  }
  return createSourceObservationModule(options.database).stageArtifact({
    artifactVersionId: options.artifactVersionId,
    xml: options.extractXml(await options.artifactStore.get(version.objectKey)),
  });
}

export async function requestFullRebuild(options: {
  database: postgres.Sql;
  databaseUrl: string;
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
          retained: number;
        },
      ]
    >`
      select
        (select count(*)::int from pgboss.job where name = ${reconcileQueue} and state in ('created', 'retry', 'active')) as "activeJobs",
        (select count(*)::int from mark) as canonical,
        (select count(*)::int from corpus_state) as "corpusStates",
        (select count(*)::int from publication) as publications,
        (select count(*)::int from artifact_version) as retained
    `;
    if (current.corpusStates > 0 || current.publications > 0) {
      throw new Error("Full rebuild requires no durable corpus or publication");
    }
    if (current.retained === 0) {
      throw new Error("Full rebuild target has no retained artifact catalog");
    }
    if (current.activeJobs > 0) {
      throw new Error("Full rebuild target already has outstanding reconciliation delivery");
    }
    await transaction`delete from mark`;
    await transaction`
      delete from source_claim claim
      using source_record record, parse_run run, artifact_version version
      where claim.source_record_id = record.id
        and record.parse_run_id = run.id
        and run.artifact_version_id = version.id
        and run.parser_version <> ${sourceObservationParserVersion}
        and run.state <> 'quarantined'
        and version.state <> 'quarantined'
    `;
    await transaction`
      delete from source_record record
      using parse_run run, artifact_version version
      where record.parse_run_id = run.id
        and run.artifact_version_id = version.id
        and run.parser_version <> ${sourceObservationParserVersion}
        and run.state <> 'quarantined'
        and version.state <> 'quarantined'
    `;
    const removedRuns = await transaction<Array<{ id: string }>>`
      delete from parse_run run
      using artifact_version version
      where run.artifact_version_id = version.id
        and run.parser_version <> ${sourceObservationParserVersion}
        and run.state <> 'quarantined'
        and version.state <> 'quarantined'
      returning run.id
    `;
    const retiredTracerVersions = await transaction<Array<{ id: string }>>`
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
    const normalized = await transaction<Array<{ id: string }>>`
      update artifact_version version set state = 'verified'
      where version.state in ('staged', 'published')
        and exists (
          select 1 from artifact_discovery discovery
          where discovery.artifact_version_id = version.id and discovery.download_state = 'verified'
        )
        and not exists (
          select 1 from parse_run run
          where run.artifact_version_id = version.id
            and run.parser_version = ${sourceObservationParserVersion}
        )
      returning version.id
    `;
    return {
      normalizedArtifactVersions: normalized.length,
      removedCanonicalMarks: current.canonical,
      removedObsoleteParseRuns: removedRuns.length,
      retainedArtifactVersions: current.retained - retiredTracerVersions.length,
      retiredTracerArtifactVersions: retiredTracerVersions.length,
    };
  });

  const boss = new PgBoss({
    connectionString: options.databaseUrl,
    migrate: false,
    supervise: false,
  });
  await boss.start();
  try {
    await boss.createQueue(reconcileQueue, reconcileQueueOptions);
    const jobId = await boss.send(reconcileQueue, { reason: "full-rebuild" });
    if (!jobId) {
      throw new Error("Full rebuild reconciliation wake was not accepted");
    }
    return {
      jobId,
      normalizedArtifactVersions: state.normalizedArtifactVersions,
      removedCanonicalMarks: state.removedCanonicalMarks,
      removedObsoleteParseRuns: state.removedObsoleteParseRuns,
      retainedArtifactVersions: state.retainedArtifactVersions,
      retiredTracerArtifactVersions: state.retiredTracerArtifactVersions,
    };
  } finally {
    await boss.stop({ close: true, graceful: true, timeout: 30_000 });
  }
}
