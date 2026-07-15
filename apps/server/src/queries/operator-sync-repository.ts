import type postgres from "postgres";

import { sourceObservationParserVersion } from "../ingestion/source-observations.ts";

type Database = postgres.Sql | postgres.TransactionSql;

export type OperatorDatasetFacts = {
  activeAttemptKind: "discovery" | "download" | null;
  activeAttemptStartedAt: Date | null;
  activeParse: boolean;
  activePublication: boolean;
  activeReconcileSince: Date | null;
  backlogCount: number;
  completeThroughDate: string | null;
  coverageFromDate: string | null;
  coverageThroughDate: string | null;
  failedCount: number;
  latestPublicationAt: Date | null;
  latestSuccessfulActivityAt: Date | null;
  product: "TRTDXFAP" | "TRTYRAP";
  providerBackoffUntil: Date | null;
  publicationRejectCount: number;
  publicationRejectedSince: Date | null;
  quarantineCount: number;
  quarantineSince: Date | null;
  rejectCount: number;
  rejectedSince: Date | null;
  reissueRequiredCount: number;
  reissueRequiredSince: Date | null;
  reconcileFailedSince: Date | null;
  reconcileFailureMessage: string | null;
  laneStatus: "backoff" | "ready" | "stopped" | null;
  laneUpdatedAt: Date | null;
  stopReason: string | null;
};

export async function readOperatorDatasetFacts(database: Database) {
  return database<OperatorDatasetFacts[]>`
    with products(product) as (values ('TRTYRAP'::text), ('TRTDXFAP'::text)),
    active_reconcile as (
      select min(started_on) as started_on from pgboss.job
      where name = 'ingestion-reconcile' and state = 'active'
    ),
    latest_discovery as (
      select distinct on (artifact_id) *
      from artifact_discovery
      order by artifact_id, observed_at desc, id desc
    ),
    latest_verified as (
      select distinct on (artifact_id) *
      from artifact_discovery
      where download_state = 'verified'
      order by artifact_id, observed_at desc, id desc
    )
    select
      attempt.kind as "activeAttemptKind",
      attempt.started_at as "activeAttemptStartedAt",
      coalesce(parse_target.product = products.product, false) as "activeParse",
      exists (
        select 1 from publication candidate
        join publication_artifact source on source.publication_id = candidate.id
        join artifact on artifact.id = source.artifact_id
        where candidate.state = 'staged'
          and candidate.parent_publication_id is not distinct from (
            select publication_id from corpus_state where id = 'uspto'
          )
          and artifact.product_id = products.product
      ) as "activePublication",
      (select started_on from active_reconcile) as "activeReconcileSince",
      (
        select count(*)::int from (
          select artifact.id
          from artifact join latest_discovery discovery on discovery.artifact_id = artifact.id
          where artifact.product_id = products.product
            and discovery.download_state in ('pending', 'downloading')
          union
          select artifact_id from artifact_version version
          join artifact on artifact.id = version.artifact_id
          where artifact.product_id = products.product and version.state in ('verified', 'parsing')
        ) outstanding
      ) as "backlogCount",
      case
        when products.product = 'TRTYRAP' and exists (
          select 1 from corpus_state state
          join publication_artifact source on source.publication_id = state.publication_id
          join artifact on artifact.id = source.artifact_id
          where state.id = 'uspto' and artifact.product_id = 'TRTYRAP'
        ) then '2025-12-31'
        when products.product = 'TRTDXFAP' then (select complete_through_date::text from corpus_state where id = 'uspto')
        else null
      end as "completeThroughDate",
      (
        select min(discovery.source_from_date)::text
        from artifact
        join artifact_version version on version.artifact_id = artifact.id and version.state in ('staged', 'published')
        join artifact_discovery discovery on discovery.artifact_version_id = version.id and discovery.download_state = 'verified'
        where artifact.product_id = products.product
      ) as "coverageFromDate",
      (
        select max(discovery.source_to_date)::text
        from artifact
        join artifact_version version on version.artifact_id = artifact.id and version.state in ('staged', 'published')
        join artifact_discovery discovery on discovery.artifact_version_id = version.id and discovery.download_state = 'verified'
        where artifact.product_id = products.product
      ) as "coverageThroughDate",
      (
        select count(*)::int
        from source_alert alert
        join source_attempt failed_attempt on failed_attempt.id = alert.attempt_id
        left join artifact_discovery failed_discovery on failed_discovery.id = failed_attempt.discovery_id
        left join artifact failed_artifact on failed_artifact.id = failed_discovery.artifact_id
        where alert.resolved_at is null
          and coalesce(failed_attempt.product_id, failed_artifact.product_id) = products.product
      ) + case when failure_impact.applies then 1 else 0 end as "failedCount",
      (
        select max(publication.published_at)
        from publication
        join publication_artifact source on source.publication_id = publication.id
        join artifact on artifact.id = source.artifact_id
        where publication.state = 'published' and artifact.product_id = products.product
      ) as "latestPublicationAt",
      (
        select max(source_attempt.finished_at)
        from source_attempt
        left join artifact_discovery discovery on discovery.id = source_attempt.discovery_id
        left join artifact on artifact.id = discovery.artifact_id
        where source_attempt.outcome = 'success'
          and coalesce(source_attempt.product_id, artifact.product_id) = products.product
      ) as "latestSuccessfulActivityAt",
      products.product,
      lane.next_eligible_at as "providerBackoffUntil",
      publication_rejection.count as "publicationRejectCount",
      publication_rejection.since as "publicationRejectedSince",
      quarantine.count as "quarantineCount",
      quarantine.since as "quarantineSince",
      rejection.count as "rejectCount",
      rejection.since as "rejectedSince",
      ambiguity.count as "reissueRequiredCount",
      ambiguity.since as "reissueRequiredSince",
      case when failure_impact.applies then reconcile_failure.completed_on else null end as "reconcileFailedSince",
      case when failure_impact.applies then reconcile_failure.output->>'message' else null end as "reconcileFailureMessage",
      lane.status as "laneStatus",
      lane.updated_at as "laneUpdatedAt",
      lane.stop_reason as "stopReason"
    from products
    left join source_lane lane on lane.id = 'uspto-odp'
    left join lateral (
      select source_attempt.kind, source_attempt.started_at
      from source_attempt
      left join artifact_discovery discovery on discovery.id = source_attempt.discovery_id
      left join artifact on artifact.id = discovery.artifact_id
      where source_attempt.outcome = 'running'
        and coalesce(source_attempt.product_id, artifact.product_id) = products.product
      order by source_attempt.started_at, source_attempt.id
      limit 1
    ) attempt on true
    left join lateral (
      select artifact.product_id as product
      from artifact_version version
      join artifact on artifact.id = version.artifact_id
      where version.state = 'verified'
        and not exists (
          select 1 from parse_run run
          where run.artifact_version_id = version.id and run.parser_version = ${sourceObservationParserVersion}
        )
      order by version.created_at, version.id
      limit 1
    ) parse_target on true
    left join lateral (
      select failed.completed_on, failed.output
      from pgboss.job failed
      where failed.name = 'ingestion-reconcile' and failed.state = 'failed'
        and failed.completed_on > coalesce((
          select max(completed_on) from pgboss.job
          where name = 'ingestion-reconcile' and state = 'completed'
        ), '-infinity'::timestamptz)
      order by failed.completed_on desc, failed.id desc
      limit 1
    ) reconcile_failure on true
    left join lateral (
      select candidate.id
      from publication candidate
      where candidate.state = 'staged'
        and candidate.parent_publication_id is not distinct from (
          select publication_id from corpus_state where id = 'uspto'
        )
      order by candidate.created_at desc, candidate.id desc
      limit 1
    ) failed_publication on true
    left join lateral (
      select case
        when reconcile_failure.completed_on is null then false
        when parse_target.product is not null then parse_target.product = products.product
        when failed_publication.id is not null then exists (
          select 1
          from publication_artifact source
          join artifact on artifact.id = source.artifact_id
          where source.publication_id = failed_publication.id
            and artifact.product_id = products.product
        )
        else true
      end as applies
    ) failure_impact on true
    left join lateral (
      select count(*)::int as count, min(coalesce(version.quarantined_at, version.created_at)) as since
      from artifact
      join latest_verified discovery on discovery.artifact_id = artifact.id
      join artifact_version version on version.id = discovery.artifact_version_id and version.state = 'quarantined'
      where artifact.product_id = products.product
        and not exists (
          select 1 from artifact_version_selection selection
          join artifact_version selected on selected.id = selection.artifact_version_id
          where selection.artifact_id = artifact.id and selected.state = 'published'
            and selection.retained_version_count = (
              select count(*)::int from artifact_version where artifact_id = artifact.id
            )
        )
    ) quarantine on true
    left join lateral (
      select count(*)::int as count, min(reject.created_at) as since
      from parse_reject reject
      join parse_run run on run.id = reject.parse_run_id
      join artifact_version version on version.id = run.artifact_version_id
      join artifact on artifact.id = version.artifact_id
      join latest_verified discovery on discovery.artifact_id = artifact.id and discovery.artifact_version_id = version.id
      where artifact.product_id = products.product and version.state = 'quarantined'
        and not exists (
          select 1 from artifact_version_selection selection
          join artifact_version selected on selected.id = selection.artifact_version_id
          where selection.artifact_id = artifact.id and selected.state = 'published'
            and selection.retained_version_count = (
              select count(*)::int from artifact_version where artifact_id = artifact.id
            )
        )
    ) rejection on true
    left join lateral (
      select count(*)::int as count, min(coalesce(rejected.rejected_at, rejected.created_at)) as since
      from publication_diagnostic diagnostic
      join publication rejected on rejected.id = diagnostic.publication_id
      where rejected.state = 'rejected'
        and rejected.created_at > coalesce((
          select last_successful_merge_at from corpus_state where id = 'uspto'
        ), '-infinity'::timestamptz)
        and coalesce(
          diagnostic.details->>'product',
          diagnostic.details->'observations'->0->>'product'
        ) = products.product
    ) publication_rejection on true
    left join lateral (
      select count(*)::int as count, min(versions.ambiguity_since) as since
      from (
        select artifact.id,
          count(version.id)::int as retained_count,
          (array_agg(version.created_at order by version.created_at, version.id))[2] as ambiguity_since
        from artifact join artifact_version version on version.artifact_id = artifact.id
        where artifact.product_id = products.product
        group by artifact.id
        having count(version.id) > 1 and exists (
          select 1 from artifact_version eligible
          join parse_run run on run.artifact_version_id = eligible.id
          where eligible.artifact_id = artifact.id
            and run.parser_version = ${sourceObservationParserVersion} and run.state = 'staged'
        )
      ) versions
      where not exists (
        select 1 from artifact_version_selection selection
        join artifact_version selected on selected.id = selection.artifact_version_id
        join parse_run run on run.artifact_version_id = selected.id
          and run.parser_version = ${sourceObservationParserVersion} and run.state = 'staged'
        where selection.artifact_id = versions.id
          and selection.retained_version_count = versions.retained_count
      )
    ) ambiguity on true
    order by products.product desc
  `;
}

export type OperatorArtifactRow = {
  artifactId: string;
  artifactVersionId: string | null;
  bytes: string | null;
  filename: string;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  observedAt: Date;
  parseRunId: string | null;
  product: "TRTDXFAP" | "TRTYRAP";
  quarantineReason: string | null;
  retainedVersionCount: number;
  selectedArtifactVersionId: string | null;
  selectedSha256: string | null;
  selectionRequired: boolean;
  sha256: string | null;
  sourceFromDate: string;
  sourceToDate: string;
  stage: "downloading" | "parsing" | "pending" | "published" | "quarantined" | "staged" | "verified";
  stageSince: Date;
};

export async function readOperatorArtifacts(
  database: Database,
  input: { limit: number; offset: number; product?: "TRTDXFAP" | "TRTYRAP" },
) {
  const product = input.product ?? null;
  const [count] = await database<[{ total: number }]>`
    select count(*)::int as total
    from artifact
    where exists (select 1 from artifact_discovery where artifact_id = artifact.id)
      and (${product}::text is null or product_id = ${product})
  `;
  const items = await database<OperatorArtifactRow[]>`
    select
      a.id as "artifactId",
      v.id as "artifactVersionId",
      v.bytes as bytes,
      a.filename,
      failure.finished_at as "lastErrorAt",
      failure.error_code as "lastErrorCode",
      discovery.observed_at as "observedAt",
      parse.id as "parseRunId",
      a.product_id as product,
      case when v.state = 'quarantined' then v.quarantine_reason else null end as "quarantineReason",
      retained.count as "retainedVersionCount",
      selection.id as "selectedArtifactVersionId",
      selection.sha256 as "selectedSha256",
      retained.count > 1 and selection.id is null as "selectionRequired",
      v.sha256,
      discovery.source_from_date::text as "sourceFromDate",
      discovery.source_to_date::text as "sourceToDate",
      case
        when discovery.download_state = 'pending' then 'pending'
        when discovery.download_state = 'downloading' then 'downloading'
        when selection.state = 'published' then 'published'
        when v.state in ('published', 'quarantined') then v.state::text
        when parse.state is not null then parse.state::text
        else v.state::text
      end as stage,
      case
        when selection.state = 'published' then coalesce(selection.published_at, selection.created_at)
        when v.state = 'published' then coalesce(published.published_at, parse.finished_at, parse.started_at, v.created_at)
        when v.state = 'quarantined' then coalesce(v.quarantined_at, parse.finished_at, parse.started_at, v.created_at)
        when parse.id is not null then coalesce(parse.finished_at, parse.started_at)
        when v.id is not null then v.created_at
        else discovery.observed_at
      end as "stageSince"
    from artifact a
    join lateral (
      select * from artifact_discovery
      where artifact_id = a.id
      order by observed_at desc, id desc
      limit 1
    ) discovery on true
    left join artifact_version v on v.id = discovery.artifact_version_id
    left join lateral (
      select count(*)::int as count from artifact_version where artifact_id = a.id
    ) retained on true
    left join lateral (
      select selected.id, selected.sha256, selected.state, selected.created_at, publication.published_at
      from artifact_version_selection chosen
      join artifact_version selected on selected.id = chosen.artifact_version_id and selected.artifact_id = a.id
      left join lateral (
        select publication.published_at
        from publication_artifact source
        join publication on publication.id = source.publication_id
        where source.artifact_version_id = selected.id and publication.state = 'published'
        order by publication.published_at desc nulls last, publication.id
        limit 1
      ) publication on true
      where chosen.artifact_id = a.id and chosen.retained_version_count = retained.count
    ) selection on true
    left join lateral (
      select * from parse_run
      where artifact_version_id = v.id
      order by started_at desc, id desc
      limit 1
    ) parse on true
    left join lateral (
      select publication.published_at
      from publication_artifact source
      join publication on publication.id = source.publication_id
      where source.artifact_version_id = v.id and publication.state = 'published'
      order by publication.published_at desc nulls last, publication.id
      limit 1
    ) published on true
    left join lateral (
      select finished_at, error_code from source_attempt
      where discovery_id = discovery.id and outcome not in ('running', 'success')
      order by finished_at desc nulls last, id desc
      limit 1
    ) failure on true
    where (${product}::text is null or a.product_id = ${product})
    order by discovery.observed_at desc, a.id
    limit ${input.limit}
    offset ${input.offset}
  `;
  return { items, total: count?.total ?? 0 };
}

export type OperatorArtifactVersionRow = {
  artifactId: string;
  artifactVersionId: string;
  bytes: string;
  createdAt: Date;
  filename: string;
  observedAt: Date | null;
  parseState: "parsing" | "quarantined" | "staged" | null;
  parserVersion: string | null;
  product: "TRTDXFAP" | "TRTYRAP";
  quarantineReason: string | null;
  selected: boolean;
  sha256: string;
  sourceFromDate: string | null;
  sourceToDate: string | null;
  state: "parsing" | "published" | "quarantined" | "staged" | "verified";
};

export async function readOperatorArtifactVersions(
  database: Database,
  input: { limit: number; offset: number; product?: "TRTDXFAP" | "TRTYRAP" },
) {
  const product = input.product ?? null;
  const [count] = await database<[{ total: number }]>`
    select count(*)::int as total
    from artifact_version version
    join artifact on artifact.id = version.artifact_id
    where exists (select 1 from artifact_discovery where artifact_version_id = version.id)
      and (${product}::text is null or artifact.product_id = ${product})
  `;
  const items = await database<OperatorArtifactVersionRow[]>`
    select
      artifact.id as "artifactId",
      version.id as "artifactVersionId",
      version.bytes,
      version.created_at as "createdAt",
      artifact.filename,
      discovery.observed_at as "observedAt",
      parse.state as "parseState",
      parse.parser_version as "parserVersion",
      artifact.product_id as product,
      version.quarantine_reason as "quarantineReason",
      coalesce(selection.artifact_version_id = version.id, false) as selected,
      version.sha256,
      discovery.source_from_date::text as "sourceFromDate",
      discovery.source_to_date::text as "sourceToDate",
      version.state
    from artifact_version version
    join artifact on artifact.id = version.artifact_id
    left join artifact_version_selection selection
      on selection.artifact_id = artifact.id
      and selection.retained_version_count = (
        select count(*)::int from artifact_version retained where retained.artifact_id = artifact.id
      )
    left join lateral (
      select observed_at, source_from_date, source_to_date
      from artifact_discovery
      where artifact_version_id = version.id and download_state = 'verified'
      order by observed_at desc, id desc
      limit 1
    ) discovery on true
    left join lateral (
      select state, parser_version
      from parse_run
      where artifact_version_id = version.id
      order by started_at desc, id desc
      limit 1
    ) parse on true
    where exists (select 1 from artifact_discovery where artifact_version_id = version.id)
      and (${product}::text is null or artifact.product_id = ${product})
    order by version.created_at desc, version.id
    limit ${input.limit}
    offset ${input.offset}
  `;
  return { items, total: count?.total ?? 0 };
}

export type OperatorPublicationRow = {
  artifactCount: number;
  completeThroughDate: string | null;
  corpusVersion: string | null;
  createdAt: Date;
  diagnosticCount: number;
  id: string;
  parentPublicationId: string | null;
  publishedAt: Date | null;
  publishedThroughDate: string | null;
  rejectedAt: Date | null;
  state: "published" | "rejected" | "staged";
};

export async function readOperatorPublications(
  database: Database,
  input: { limit: number; offset: number },
) {
  const [count] = await database<[{ total: number }]>`select count(*)::int as total from publication`;
  const items = await database<OperatorPublicationRow[]>`
    select
      p.artifact_count as "artifactCount",
      p.complete_through_date::text as "completeThroughDate",
      p.corpus_version as "corpusVersion",
      p.created_at as "createdAt",
      (select count(*)::int from publication_diagnostic where publication_id = p.id) as "diagnosticCount",
      p.id,
      p.parent_publication_id as "parentPublicationId",
      p.published_at as "publishedAt",
      p.published_through_date::text as "publishedThroughDate",
      p.rejected_at as "rejectedAt",
      p.state
    from publication p
    order by p.created_at desc, p.id
    limit ${input.limit}
    offset ${input.offset}
  `;
  return { items, total: count?.total ?? 0 };
}

export type OperatorRejectionRow = {
  artifactVersionSha256: string | null;
  bytes: number | null;
  claimPath: string | null;
  createdAt: Date;
  diagnostic: Record<string, unknown> | null;
  digest: string | null;
  filename: string | null;
  group: string | null;
  id: string;
  kind: "authority-conflict" | "parse-reject" | "unsupported-semantics";
  parseRunId: string | null;
  physicalRecordIndex: number | null;
  product: "TRTDXFAP" | "TRTYRAP" | null;
  publicationId: string | null;
  reason: string;
  serialNumber: string | null;
};

function rejectionRows(database: Database) {
  return database`
    select
      reject.id::text as id,
      'parse-reject'::text as kind,
      a.product_id as product,
      a.filename,
      v.sha256 as "artifactVersionSha256",
      reject.parse_run_id as "parseRunId",
      null::uuid as "publicationId",
      null::text as "serialNumber",
      reject.physical_record_index as "physicalRecordIndex",
      reject.reason,
      null::text as "claimPath",
      null::text as "groupName",
      reject.created_at as "createdAt",
      reject.digest,
      reject.bytes,
      null::jsonb as diagnostic
    from parse_reject reject
    join parse_run parse on parse.id = reject.parse_run_id
    join artifact_version v on v.id = parse.artifact_version_id
    join artifact a on a.id = v.artifact_id

    union all

    select
      diagnostic.diagnostic_key as id,
      diagnostic.kind::text as kind,
      coordinate.product,
      source.filename,
      coordinate.sha256 as "artifactVersionSha256",
      null::uuid as "parseRunId",
      diagnostic.publication_id as "publicationId",
      diagnostic.serial_number as "serialNumber",
      coordinate.physical_record_index as "physicalRecordIndex",
      diagnostic.kind::text as reason,
      diagnostic.details->>'claimPath' as "claimPath",
      diagnostic.details->>'group' as "groupName",
      coalesce(publication.rejected_at, publication.created_at) as "createdAt",
      null::text as digest,
      null::int as bytes,
      case diagnostic.kind
        when 'authority-conflict' then jsonb_build_object(
          'competingValues', diagnostic.details->'competingValues',
          'policyVersion', diagnostic.details->>'policyVersion'
        )
        else jsonb_build_object(
          'operation', diagnostic.details->>'operation',
          'presence', diagnostic.details->>'presence',
          'profile', diagnostic.details->>'profile'
        )
      end as diagnostic
    from publication_diagnostic diagnostic
    join publication on publication.id = diagnostic.publication_id
    cross join lateral (
      select
        coalesce(diagnostic.details->>'product', diagnostic.details->'observations'->0->>'product') as product,
        coalesce(
          diagnostic.details->>'artifactVersionSha256',
          diagnostic.details->'observations'->0->>'artifactVersionSha256'
        ) as sha256,
        coalesce(
          (diagnostic.details->>'physicalRecordIndex')::int,
          (diagnostic.details->'observations'->0->>'physicalRecordIndex')::int
        ) as physical_record_index
    ) coordinate
    left join lateral (
      select artifact.filename
      from artifact_version version
      join artifact on artifact.id = version.artifact_id
      where version.sha256 = coordinate.sha256 and artifact.product_id = coordinate.product
      order by artifact.filename
      limit 1
    ) source on true
  `;
}

export async function readOperatorRejections(
  database: Database,
  input: { limit: number; offset: number; product?: "TRTDXFAP" | "TRTYRAP" },
) {
  const product = input.product ?? null;
  const [count] = await database<[{ total: number }]>`
    with rejections as (${rejectionRows(database)})
    select count(*)::int as total from rejections
    where (${product}::text is null or product = ${product})
  `;
  const items = await database<OperatorRejectionRow[]>`
    with rejections as (${rejectionRows(database)})
    select
      id, kind, product, filename, "artifactVersionSha256", "parseRunId", "publicationId",
      "serialNumber", "physicalRecordIndex", reason, "claimPath", "groupName" as "group",
      "createdAt", digest, bytes, diagnostic
    from rejections
    where (${product}::text is null or product = ${product})
    order by "createdAt" desc, id
    limit ${input.limit}
    offset ${input.offset}
  `;
  return { items, total: count?.total ?? 0 };
}
