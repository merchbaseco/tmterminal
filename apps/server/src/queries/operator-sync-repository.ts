import type postgres from "postgres";

import type { OperatorArtifact, OperatorPageInput } from "../api/contracts.ts";

export interface OperatorAttentionRow {
  artifactId: string;
  filename: string;
  httpStatus: number | null;
  message: string | null;
  providerRequestCount: number | null;
  retryNotBefore: Date | null;
  stage: "application" | "download" | "worker";
  updatedAt: Date;
}

type ArtifactRow = Omit<
  OperatorArtifact,
  "applicationCompletedAt" | "bytes" | "downloadedAt" | "updatedAt"
> & {
  applicationCompletedAt: Date | null;
  bytes: string | null;
  downloadedAt: Date | null;
  updatedAt: Date;
};

export async function readOperatorArtifacts(
  database: postgres.Sql | postgres.TransactionSql,
  input: OperatorPageInput
) {
  const [count] = await database<
    Array<{ total: number }>
  >`select count(*)::int as total from source_artifact`;
  const items = await database<ArtifactRow[]>`
    select application_completed_at as "applicationCompletedAt",
      application_state as "applicationState", applied_record_count as "appliedRecordCount",
      id as "artifactId", bytes::text, current_error as "currentError",
      download_response_state as "downloadResponseState", download_state as "downloadState",
      downloaded_at as "downloadedAt", filename, physical_record_count as "physicalRecordCount", product,
      parser_version as "parserVersion", processing_disposition as "processingDisposition",
      projected_mark_count as "projectedMarkCount", sha256, source_from_date::text as "sourceFromDate",
      source_to_date::text as "sourceToDate",
      case when object_key is not null then 'retained'
        when application_state = 'complete' then 'cleaned-up'
        else 'not-downloaded' end as "storageState",
      unresolved_record_count as "unresolvedRecordCount",
      updated_at as "updatedAt"
    from source_artifact order by source_to_date desc, filename desc
    limit ${input.limit} offset ${input.offset}
  `;
  return { items, total: count?.total ?? 0 };
}

interface OperatorSourceSummaryRow {
  attentionCount: number;
  lastActivityAt: Date | null;
  latestProcessedDate: string | null;
}

export async function readOperatorSourceSummary(database: postgres.Sql | postgres.TransactionSql) {
  const [summary] = await database<OperatorSourceSummaryRow[]>`
    select count(*) filter (where processing_disposition = 'required'
        and (application_state = 'needs_attention'
          or download_state = 'blocked'))::int as "attentionCount",
      max(updated_at) as "lastActivityAt",
      max(source_to_date) filter (where applied_record_count > 0)::text as "latestProcessedDate"
    from source_artifact
  `;
  if (!summary) {
    throw new Error("Operator source summary is unavailable");
  }
  return summary;
}

interface OperatorCatalogSummaryRow {
  liveMarkCount: number;
  registeredMarkCount: number;
  totalMarkCount: number;
}

export async function readOperatorCatalogSummary(database: postgres.Sql | postgres.TransactionSql) {
  const [summary] = await database<OperatorCatalogSummaryRow[]>`
    select count(*)::int as "totalMarkCount",
      count(*) filter (where search_status = 'live')::int as "liveMarkCount",
      count(*) filter (where registration_number is not null)::int as "registeredMarkCount"
    from mark
  `;
  if (!summary) {
    throw new Error("Operator catalog summary is unavailable");
  }
  return summary;
}

interface OperatorProcessingActivityRow {
  count: number;
  date: string;
}

export function readOperatorProcessingActivity(database: postgres.Sql | postgres.TransactionSql) {
  return database<OperatorProcessingActivityRow[]>`
    with days as (
      select generate_series(
        (current_timestamp at time zone 'UTC')::date - 29,
        (current_timestamp at time zone 'UTC')::date,
        interval '1 day'
      )::date as day
    ), processed as (
      select (application_completed_at at time zone 'UTC')::date as day,
        sum(applied_record_count)::int as count
      from source_artifact
      where applied_record_count > 0 and application_completed_at is not null
        and (application_completed_at at time zone 'UTC')::date between
          (current_timestamp at time zone 'UTC')::date - 29
          and (current_timestamp at time zone 'UTC')::date
      group by (application_completed_at at time zone 'UTC')::date
    )
    select days.day::text as date, coalesce(processed.count, 0)::int as count
    from days
    left join processed on processed.day = days.day
    order by days.day
  `;
}

export function readOperatorAttentionArtifacts(
  database: postgres.Sql | postgres.TransactionSql,
  limit: number
) {
  return database<OperatorAttentionRow[]>`
    select id as "artifactId", filename,
      case when download_state = 'blocked' then 'download' else 'application' end as stage,
      null::text as message,
      case when download_state = 'blocked'
        then (download_response_state ->> 'status')::int else null end as "httpStatus",
      case when download_state = 'blocked'
        then (download_response_state ->> 'providerRequestCount')::int else null end as "providerRequestCount",
      case when download_state = 'blocked'
        then (download_response_state ->> 'retryNotBefore')::timestamptz else null end as "retryNotBefore",
      updated_at as "updatedAt"
    from source_artifact
    where processing_disposition = 'required'
      and (application_state = 'needs_attention' or download_state = 'blocked')
    order by source_to_date desc, filename desc
    limit ${limit}
  `;
}

export async function readOperatorWorkerAttention(
  database: postgres.Sql | postgres.TransactionSql
) {
  const [item] = await database<OperatorAttentionRow[]>`
    select 'worker' as "artifactId", 'Ingestion worker' as filename,
      null::int as "httpStatus",
      case when current_error is not null then current_error
        else 'The ingestion worker has not reported activity in more than five minutes.' end as message,
      null::int as "providerRequestCount", null::timestamptz as "retryNotBefore",
      'worker' as stage, coalesce(last_heartbeat_at, updated_at) as "updatedAt"
    from worker_status
    where id = 'uspto' and (current_error is not null
      or coalesce(last_heartbeat_at, updated_at) < current_timestamp - interval '5 minutes')
  `;
  return item ?? null;
}
