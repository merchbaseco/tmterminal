import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { annualGenerationV1Artifacts } from "../ingestion/annual-generation-v1.ts";
import type { StoredArtifact } from "../ingestion/artifact-store.ts";
import type {
  DiscoveredArtifact,
  DiscoveredProduct,
  SourceResponseState,
} from "../ingestion/source-catalog.ts";
import { sourceObservationParserVersion } from "../ingestion/source-observations.ts";
import { lockCorpusPublication } from "./corpus-publication-lock.ts";

export const sourceLaneId = "uspto-odp";

async function inReservedTransaction<T>(database: postgres.Sql, work: () => Promise<T>) {
  await database`begin`;
  try {
    const result = await work();
    await database`commit`;
    return result;
  } catch (error) {
    await database`rollback`;
    throw error;
  }
}

export async function ensureArtifactScheduler(database: postgres.Sql, productIds: string[]) {
  await database`
    insert into source_lane (id)
    values (${sourceLaneId})
    on conflict (id) do nothing
  `;
  if (productIds.length > 0) {
    await database`
      insert into dataset_product ${database(productIds.map((id) => ({ id })))}
      on conflict (id) do nothing
    `;
  }
}

export async function reserveArtifactScheduler(database: postgres.Sql) {
  const reserved = await database.reserve();
  const [lock] = await reserved<[{ acquired: boolean }]>`
    select pg_try_advisory_lock(hashtext(${sourceLaneId})) as acquired
  `;
  if (!lock?.acquired) {
    reserved.release();
    return null;
  }
  return {
    database: reserved,
    async release() {
      await reserved`select pg_advisory_unlock(hashtext(${sourceLaneId}))`;
      reserved.release();
    },
  };
}

export async function readSourceLane(database: postgres.Sql) {
  const [lane] = await database<
    [
      {
        nextEligibleAt: Date | null;
        status: "ready" | "backoff" | "stopped";
        transientFailureCount: number;
      },
    ]
  >`
    select
      next_eligible_at as "nextEligibleAt",
      status,
      transient_failure_count as "transientFailureCount"
    from source_lane
    where id = ${sourceLaneId}
  `;
  if (!lane) {
    throw new Error("USPTO source lane is missing");
  }
  return lane;
}

export async function findDueProduct(database: postgres.Sql, now: Date) {
  const [product] = await database<[{ id: string }]>`
    select id
    from dataset_product
    where next_discovery_at is null or next_discovery_at <= ${now}
    order by id
    limit 1
  `;
  return product ?? null;
}

export async function findInterruptedAttempt(database: postgres.Sql) {
  const [attempt] = await database<[{ attemptId: string; discoveryId: string | null }]>`
    select id as "attemptId", discovery_id as "discoveryId"
    from source_attempt
    where lane_id = ${sourceLaneId} and outcome = 'running'
    order by started_at
    limit 1
  `;
  return attempt ?? null;
}

export async function startSourceAttempt(database: postgres.Sql, productId: string, now: Date) {
  const id = randomUUID();
  await database`
    insert into source_attempt (id, lane_id, kind, product_id, started_at)
    values (${id}, ${sourceLaneId}, 'discovery', ${productId}, ${now})
  `;
  return id;
}

export async function findPendingDiscovery(database: postgres.Sql) {
  const [discovery] = await database<
    [
      {
        artifactId: string;
        discoveryId: string;
        downloadUrl: string;
        expectedBytes: string;
        filename: string;
      },
    ]
  >`
    select
      d.id as "discoveryId",
      d.artifact_id as "artifactId",
      a.filename,
      d.download_url as "downloadUrl",
      d.expected_bytes as "expectedBytes"
    from artifact_discovery d
    join artifact a on a.id = d.artifact_id
    where d.download_state in ('pending', 'downloading')
    order by
      case when
        a.product_id = 'TRTYRAP'
        and a.filename in ${database([...annualGenerationV1Artifacts])}
        and d.source_from_date = '1884-04-07'
        and d.source_to_date = '2025-12-31'
      then 0 else 1 end,
      d.release_date,
      a.product_id,
      a.filename,
      d.observed_at,
      d.id
    limit 1
  `;
  return discovery ? { ...discovery, expectedBytes: Number(discovery.expectedBytes) } : null;
}

export async function startDownloadAttempt(database: postgres.Sql, discoveryId: string, now: Date) {
  const id = randomUUID();
  await inReservedTransaction(database, async () => {
    await database`
      update artifact_discovery set download_state = 'downloading' where id = ${discoveryId}
    `;
    await database`
      insert into source_attempt (id, lane_id, kind, discovery_id, started_at)
      values (${id}, ${sourceLaneId}, 'download', ${discoveryId}, ${now})
    `;
  });
  return id;
}

type FingerprintedArtifact = DiscoveredArtifact & { fingerprint: string };

export function reconcileDiscoverySuccess(
  database: postgres.Sql,
  discovery: DiscoveredProduct,
  artifacts: FingerprintedArtifact[],
  attemptId: string,
  observedAt: Date,
  nextDiscoveryAt: Date
) {
  return inReservedTransaction(database, async () => {
    await lockCorpusPublication(database);
    await database`
      update dataset_product
      set
        title = ${discovery.product.title},
        frequency = ${discovery.product.frequency},
        metadata_last_modified_at = ${new Date(discovery.product.lastModifiedAt)},
        next_discovery_at = ${nextDiscoveryAt},
        updated_at = ${observedAt}
      where id = ${discovery.product.identifier}
    `;

    let changed = false;
    for (const artifact of artifacts) {
      // biome-ignore lint/performance/noAwaitInLoops: Provider artifacts are retained in observed order within one transaction.
      const [logicalArtifact] = await database<[{ id: string }]>`
        with inserted as (
          insert into artifact (id, product_id, filename, created_at, updated_at)
          values (${randomUUID()}, ${discovery.product.identifier}, ${artifact.filename}, ${observedAt}, ${observedAt})
          on conflict (product_id, filename) do nothing
          returning id
        )
        select id from inserted
        union all
        select id from artifact
        where product_id = ${discovery.product.identifier} and filename = ${artifact.filename}
        limit 1
      `;
      if (!logicalArtifact) {
        throw new Error("Artifact upsert returned no row");
      }

      const [observation] = await database<[{ id: string }]>`
        insert into artifact_discovery (
          id, artifact_id, fingerprint, observed_at, download_url, expected_bytes,
          source_from_date, source_to_date, release_date, source_last_modified_at
        ) values (
          ${randomUUID()}, ${logicalArtifact.id}, ${artifact.fingerprint}, ${observedAt}, ${artifact.downloadUrl},
          ${artifact.bytes}, ${artifact.fromDate}, ${artifact.toDate}, ${artifact.releaseDate},
          ${new Date(artifact.lastModifiedAt)}
        )
        on conflict (artifact_id, fingerprint) do nothing
        returning id
      `;
      if (!observation) {
        continue;
      }

      changed = true;
      await database`update artifact set updated_at = ${observedAt} where id = ${logicalArtifact.id}`;
    }
    await database`
      update source_attempt set
        outcome = 'success',
        finished_at = ${observedAt},
        response_state = ${database.json(discovery.responseState)}
      where id = ${attemptId}
    `;
    await database`
      update source_lane
      set
        status = 'ready',
        next_eligible_at = null,
        transient_failure_count = 0,
        last_response_state = ${database.json(discovery.responseState)},
        stop_reason = null,
        updated_at = ${observedAt}
      where id = ${sourceLaneId}
    `;
    return changed;
  });
}

export async function finishSourceAttemptFailure(
  database: postgres.Sql,
  input: {
    alertKind: "credential" | "permanent" | null;
    discoveryId: string | null;
    attemptId: string;
    errorCode: string;
    finishedAt: Date;
    nextEligibleAt: Date | null;
    outcome: "credential_failure" | "permanent_failure" | "transient_failure";
    responseState: SourceResponseState;
    transientFailureCount: number;
  }
) {
  await inReservedTransaction(database, async () => {
    await database`
      update source_attempt
      set
        outcome = ${input.outcome},
        finished_at = ${input.finishedAt},
        response_state = ${database.json(input.responseState)},
        retry_eligible_at = ${input.nextEligibleAt},
        error_code = ${input.errorCode}
      where id = ${input.attemptId}
    `;
    if (input.discoveryId) {
      await database`
        update artifact_discovery set download_state = 'pending'
        where id = ${input.discoveryId}
      `;
    }
    const stopped = input.alertKind !== null;
    await database`
      update source_lane
      set
        status = ${stopped ? "stopped" : "backoff"},
        next_eligible_at = ${input.nextEligibleAt},
        transient_failure_count = ${input.transientFailureCount},
        last_response_state = ${database.json(input.responseState)},
        stop_reason = ${stopped ? input.errorCode : null},
        updated_at = ${input.finishedAt}
      where id = ${sourceLaneId}
    `;
    if (input.alertKind) {
      const message =
        input.alertKind === "credential"
          ? "USPTO credential rejected"
          : "USPTO request permanently rejected";
      await database`
        insert into source_alert (id, lane_id, attempt_id, kind, message, created_at)
        values (${randomUUID()}, ${sourceLaneId}, ${input.attemptId}, ${input.alertKind}, ${message}, ${input.finishedAt})
        on conflict (attempt_id) do nothing
      `;
    }
  });
}

export function retainArtifactVersion(
  database: postgres.Sql,
  artifactId: string,
  discoveryId: string,
  attemptId: string,
  stored: StoredArtifact,
  responseState: SourceResponseState,
  now: Date
) {
  return inReservedTransaction(database, async () => {
    await lockCorpusPublication(database);
    const [version] = await database<[{ created: boolean; id: string }]>`
      with inserted as (
        insert into artifact_version (id, artifact_id, sha256, bytes, object_key, created_at)
        values (${randomUUID()}, ${artifactId}, ${stored.sha256}, ${stored.bytes}, ${stored.objectKey}, ${now})
        on conflict (artifact_id, sha256) do nothing
        returning id
      )
      select id, true as created from inserted
      union all
      select id, false as created from artifact_version
      where artifact_id = ${artifactId} and sha256 = ${stored.sha256}
        and not exists (select 1 from inserted)
      limit 1
    `;
    if (!version) {
      throw new Error("Artifact version insert returned no row");
    }
    await database`
      update artifact_version set object_key = ${stored.objectKey}
      where id = ${version.id}
    `;
    await database`
      update artifact_discovery
      set download_state = 'verified', artifact_version_id = ${version.id}
      where id = ${discoveryId}
    `;
    await database`
      update source_attempt
      set outcome = 'success', finished_at = ${now}, response_state = ${database.json(responseState)}
      where id = ${attemptId}
    `;
    await database`
      update source_lane
      set
        status = 'ready',
        next_eligible_at = null,
        transient_failure_count = 0,
        last_response_state = ${database.json(responseState)},
        stop_reason = null,
        updated_at = ${now}
      where id = ${sourceLaneId}
    `;
    return version.created;
  });
}

export async function findArtifactVersionForParsing(database: postgres.Sql) {
  const [artifact] = await database<Array<{ artifactVersionId: string; objectKey: string }>>`
    select v.id as "artifactVersionId", v.object_key as "objectKey"
    from artifact_version v
    join artifact a on a.id = v.artifact_id
    where v.state = 'verified'
      and v.object_key is not null
      and exists (
      select 1 from artifact_discovery d
      where d.artifact_version_id = v.id and d.download_state = 'verified'
    )
      and not exists (
        select 1 from parse_run p
        where p.artifact_version_id = v.id and p.parser_version = ${sourceObservationParserVersion}
      )
    order by
      case when
        a.product_id = 'TRTYRAP'
        and a.filename in ${database([...annualGenerationV1Artifacts])}
        and exists (
          select 1 from artifact_discovery annual
          where annual.artifact_version_id = v.id
            and annual.download_state = 'verified'
            and annual.source_from_date = '1884-04-07'
            and annual.source_to_date = '2025-12-31'
        )
      then 0 else 1 end,
      v.created_at,
      v.id
    limit 1
  `;
  return artifact ?? null;
}

export async function findArtifactObjectForCleanup(database: postgres.Sql) {
  const [artifact] = await database<Array<{ artifactVersionId: string; objectKey: string }>>`
    select id as "artifactVersionId", object_key as "objectKey"
    from artifact_version
    where state in ('staged', 'published', 'quarantined')
      and object_key is not null
    order by created_at, id
    limit 1
  `;
  return artifact ?? null;
}

export async function artifactObjectHasReference(database: postgres.Sql, objectKey: string) {
  const [result] = await database<[{ referenced: boolean }]>`
    select exists (
      select 1 from artifact_version where object_key = ${objectKey}
    ) as referenced
  `;
  return result?.referenced ?? false;
}

export function releaseArtifactObjectReference(
  database: postgres.Sql,
  artifactVersionId: string,
  objectKey: string
) {
  return database.begin(async (transaction) => {
    await lockCorpusPublication(transaction);
    const [cleared] = await transaction<Array<{ id: string }>>`
      update artifact_version set object_key = null
      where id = ${artifactVersionId} and object_key = ${objectKey}
      returning id
    `;
    if (!cleared) {
      return false;
    }
    const [remaining] = await transaction<[{ referenced: boolean }]>`
      select exists (
        select 1 from artifact_version where object_key = ${objectKey}
      ) as referenced
    `;
    return remaining?.referenced === false;
  });
}
