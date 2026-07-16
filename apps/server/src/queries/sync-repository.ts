import type postgres from "postgres";

import { annualGenerationV1Artifacts } from "../ingestion/annual-generation-v1.ts";
import { sourceObservationParserVersion } from "../ingestion/source-observations.ts";

export interface SyncFacts {
  activeAttemptKind: "discovery" | "download" | null;
  activeAttemptStartedAt: Date | null;
  completeThroughDate: string | null;
  corpusVersion: number;
  currentDate: string;
  failedCount: number;
  failedSince: Date | null;
  hasParseTarget: boolean;
  hasPublicationTarget: boolean;
  laneNextEligibleAt: Date | null;
  laneStatus: "backoff" | "ready" | "stopped" | null;
  laneUpdatedAt: Date | null;
  lastSuccessfulMergeAt: Date | null;
  pendingCount: number;
  publishedThroughDate: string | null;
  quarantineCount: number;
  reconcileActiveSince: Date | null;
  reconcileFailedSince: Date | null;
  reconcileFailureMessage: string | null;
  reissueSelectionRequiredCount: number;
  reissueSelectionRequiredSince: Date | null;
  rejectCount: number;
  rejectedSince: Date | null;
}

export async function readSyncFacts(
  database: postgres.Sql | postgres.TransactionSql
): Promise<SyncFacts> {
  const [facts] = await database<[SyncFacts]>`
    with latest_verified as (
      select distinct on (a.id)
        a.id as artifact_id,
        v.id as artifact_version_id,
        v.state,
        v.created_at,
        v.quarantined_at
      from artifact a
      join artifact_discovery d on d.artifact_id = a.id and d.download_state = 'verified'
      join artifact_version v on v.id = d.artifact_version_id
      order by a.id, d.observed_at desc, d.id desc
    ),
    blocking_quarantines as (
      select current.*
      from latest_verified current
      where current.state = 'quarantined'
        and not exists (
          select 1
          from artifact_version_selection selection
          join artifact_version selected on selected.id = selection.artifact_version_id
          where selection.artifact_id = current.artifact_id
            and selection.retained_version_count = (
              select count(*)::int from artifact_version where artifact_id = current.artifact_id
            )
            and selected.state = 'published'
        )
    ),
    ambiguities as (
      select
        version.artifact_id,
        count(*)::int as retained_count,
        (array_agg(version.created_at order by version.created_at, version.id))[2] as ambiguity_since
      from artifact_version version
      join artifact on artifact.id = version.artifact_id
      where artifact.product_id = 'TRTYRAP'
        and artifact.filename in ${database([...annualGenerationV1Artifacts])}
      group by version.artifact_id
      having count(*) > 1 and exists (
        select 1
        from artifact_version eligible
        join parse_run run on run.artifact_version_id = eligible.id
        join artifact_discovery discovery on discovery.artifact_version_id = eligible.id
          and discovery.download_state = 'verified'
          and discovery.source_from_date = '1884-04-07'
          and discovery.source_to_date = '2025-12-31'
        where eligible.artifact_id = version.artifact_id
          and run.parser_version = ${sourceObservationParserVersion}
          and run.state = 'staged'
      )
    ),
    unresolved_ambiguities as (
      select ambiguity.*
      from ambiguities ambiguity
      where not exists (
        select 1
        from artifact_version_selection selection
        join artifact_version selected on selected.id = selection.artifact_version_id
        where selection.artifact_id = ambiguity.artifact_id
          and selection.retained_version_count = ambiguity.retained_count
          and selected.artifact_id = ambiguity.artifact_id
          and exists (
            select 1 from parse_run run
            where run.artifact_version_id = selected.id
              and run.parser_version = ${sourceObservationParserVersion}
              and run.state = 'staged'
          )
      )
    ),
    active_reconcile as (
      select min(started_on) as started_on from pgboss.job
      where name = 'ingestion-reconcile' and state = 'active'
    )
    select
      (
        select kind from source_attempt
        where outcome = 'running'
        order by started_at, id
        limit 1
      ) as "activeAttemptKind",
      (
        select started_at from source_attempt
        where outcome = 'running'
        order by started_at, id
        limit 1
      ) as "activeAttemptStartedAt",
      state.complete_through_date::text as "completeThroughDate",
      coalesce(state.corpus_version, 0)::int as "corpusVersion",
      current_date::text as "currentDate",
      (select count(*)::int from source_alert where resolved_at is null) as "failedCount",
      (select min(created_at) from source_alert where resolved_at is null) as "failedSince",
      exists (
        select 1 from artifact_version version
        where version.state = 'verified'
          and not exists (
            select 1 from parse_run run
            where run.artifact_version_id = version.id
              and run.parser_version = ${sourceObservationParserVersion}
          )
      ) as "hasParseTarget",
      exists (
        select 1 from publication candidate
        where candidate.state = 'staged'
          and candidate.parent_publication_id is not distinct from state.publication_id
      ) as "hasPublicationTarget",
      state.last_successful_merge_at as "lastSuccessfulMergeAt",
      lane.next_eligible_at as "laneNextEligibleAt",
      lane.status as "laneStatus",
      lane.updated_at as "laneUpdatedAt",
      (
        select count(*)::int
        from (
          select artifact_id
          from (
            select distinct on (artifact_id) artifact_id, download_state
            from artifact_discovery
            order by artifact_id, observed_at desc, id desc
          ) latest
          where latest.download_state in ('pending', 'downloading')
          union
          select artifact_id from artifact_version where state in ('verified', 'parsing')
        ) outstanding
      ) as "pendingCount",
      state.published_through_date::text as "publishedThroughDate",
      (select count(*)::int from blocking_quarantines) as "quarantineCount",
      (select started_on from active_reconcile) as "reconcileActiveSince",
      reconcile_failure.completed_on as "reconcileFailedSince",
      reconcile_failure.output->>'message' as "reconcileFailureMessage",
      (
        (
          select count(*)::int from parse_reject reject
          join parse_run run on run.id = reject.parse_run_id
          join blocking_quarantines quarantine on quarantine.artifact_version_id = run.artifact_version_id
        ) + (
          select count(*)::int from publication_diagnostic diagnostic
          join publication rejected on rejected.id = diagnostic.publication_id
          where rejected.state = 'rejected'
            and rejected.created_at > coalesce(state.last_successful_merge_at, '-infinity'::timestamptz)
        )
      ) as "rejectCount",
      least(
        (
          select min(reject.created_at) from parse_reject reject
          join parse_run run on run.id = reject.parse_run_id
          join blocking_quarantines quarantine on quarantine.artifact_version_id = run.artifact_version_id
        ),
        (
          select min(rejected_at) from publication
          where state = 'rejected'
            and created_at > coalesce(state.last_successful_merge_at, '-infinity'::timestamptz)
        ),
        (select min(coalesce(quarantined_at, created_at)) from blocking_quarantines)
      ) as "rejectedSince"
      ,(
        select count(*)::int from unresolved_ambiguities
      ) as "reissueSelectionRequiredCount",
      (select min(ambiguity_since) from unresolved_ambiguities) as "reissueSelectionRequiredSince"
    from (select 1) anchor
    left join corpus_state state on state.id = 'uspto'
    left join source_lane lane on lane.id = 'uspto-odp'
    left join lateral (
      select failed.completed_on, failed.output
      from pgboss.job failed
      where failed.name = 'ingestion-reconcile'
        and failed.state = 'failed'
        and failed.completed_on > coalesce((
          select max(completed_on) from pgboss.job completed
          where completed.name = 'ingestion-reconcile' and completed.state = 'completed'
        ), '-infinity'::timestamptz)
      order by failed.completed_on desc, failed.id desc
      limit 1
    ) reconcile_failure on true
  `;
  if (!facts) {
    throw new Error("Sync status query returned no row");
  }
  return { ...facts, corpusVersion: Number(facts.corpusVersion) };
}
