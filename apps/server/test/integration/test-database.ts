import type postgres from "postgres";

export async function resetTestDatabase(database: postgres.Sql) {
  await database.unsafe("drop schema if exists drizzle cascade");
  await database.unsafe("drop schema if exists public cascade");
  await database.unsafe("create schema public");
}

export async function readArtifactInventory(database: postgres.Sql) {
  const [counts] = await database<[{ discoveryCount: number; productCount: number }]>`
    select
      (select count(*)::int from artifact_discovery) as "discoveryCount",
      (select count(*)::int from dataset_product) as "productCount"
  `;
  const [lane] = await database<Array<{ status: string; transientFailureCount: number }>>`
    select status, transient_failure_count as "transientFailureCount"
    from source_lane where id = 'uspto-odp'
  `;
  const artifacts = await database<Array<{ downloadState: string; filename: string }>>`
    select filename, "downloadState"
    from (
      select distinct on (a.id)
        a.id,
        a.product_id,
        a.filename,
        d.download_state as "downloadState"
      from artifact a
      join artifact_discovery d on d.artifact_id = a.id
      order by a.id, d.observed_at desc, d.id desc
    ) current_discovery
    order by product_id, filename
  `;
  const discoveries = await database<Array<{ downloadState: string; downloadUrl: string; versionSha256: string | null }>>`
    select
      d.download_state as "downloadState",
      d.download_url as "downloadUrl",
      v.sha256 as "versionSha256"
    from artifact_discovery d
    left join artifact_version v on v.id = d.artifact_version_id
    order by d.observed_at, d.id
  `;
  const versions = await database<Array<{ filename: string; sha256: string }>>`
    select a.filename, v.sha256
    from artifact_version v
    join artifact a on a.id = v.artifact_id
    order by v.sha256
  `;
  const attempts = await database<
    Array<{
      errorCode: string | null;
      outcome: string;
      responseState: Record<string, unknown> | null;
      retryEligibleAt: Date | null;
    }>
  >`
    select
      error_code as "errorCode",
      outcome,
      response_state as "responseState",
      retry_eligible_at as "retryEligibleAt"
    from source_attempt order by started_at, id
  `;
  const alerts = await database<Array<{ kind: string; message: string }>>`
    select kind, message from source_alert order by created_at, id
  `;
  if (!counts || !lane) throw new Error("Artifact inventory query returned no row");
  return { ...counts, alerts, artifacts, attempts, discoveries, lane, versions };
}
