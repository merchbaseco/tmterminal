import type postgres from "postgres";

import type { OperatorArtifact, OperatorPageInput } from "../api/contracts.ts";

export interface OperatorAttentionRow {
  artifactId: string;
  filename: string;
  httpStatus: number | null;
  providerRequestCount: number | null;
  retryNotBefore: Date | null;
  stage: "application" | "download";
  updatedAt: Date;
}

type ArtifactRow = Omit<
  OperatorArtifact,
  "bytes" | "downloadedAt" | "projectionCompletedAt" | "updatedAt"
> & {
  bytes: string | null;
  downloadedAt: Date | null;
  projectionCompletedAt: Date | null;
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
    select id as "artifactId", bytes::text, download_error as "downloadError",
      download_response_state as "downloadResponseState", download_state as "downloadState",
      downloaded_at as "downloadedAt", filename, physical_record_count as "physicalRecordCount", product,
      projection_completed_at as "projectionCompletedAt", projection_error as "projectionError",
      projection_state as "projectionState", projection_version as "projectionVersion",
      projected_mark_count as "projectedMarkCount", sha256, source_from_date::text as "sourceFromDate",
      source_to_date::text as "sourceToDate",
      case when object_key is not null then 'retained'
        when projection_state = 'complete' then 'cleaned-up'
        else 'not-downloaded' end as "storageState",
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
    select count(*) filter (where projection_state = 'failed'
        or (projection_state <> 'complete' and download_state in ('failed', 'unavailable')))::int as "attentionCount",
      max(updated_at) as "lastActivityAt",
      max(source_to_date) filter (where projection_state = 'complete')::text as "latestProcessedDate"
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
      select (projection_completed_at at time zone 'UTC')::date as day,
        sum(physical_record_count)::int as count
      from source_artifact
      where projection_state = 'complete'
        and (projection_completed_at at time zone 'UTC')::date between
          (current_timestamp at time zone 'UTC')::date - 29
          and (current_timestamp at time zone 'UTC')::date
      group by (projection_completed_at at time zone 'UTC')::date
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
      case when projection_state = 'failed' then 'application' else 'download' end as stage,
      case when projection_state = 'failed' then null
        else (download_response_state ->> 'status')::int end as "httpStatus",
      case when projection_state = 'failed' then null
        else (download_response_state ->> 'providerRequestCount')::int end as "providerRequestCount",
      case when projection_state = 'failed' then null
        else (download_response_state ->> 'retryNotBefore')::timestamptz end as "retryNotBefore",
      updated_at as "updatedAt"
    from source_artifact
    where projection_state = 'failed'
      or (projection_state <> 'complete' and download_state in ('failed', 'unavailable'))
    order by source_to_date desc, filename desc
    limit ${limit}
  `;
}
