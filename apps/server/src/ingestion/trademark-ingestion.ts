import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { lockIngestion } from "../queries/ingestion-lock.ts";
import { ArtifactIntegrityError, type ArtifactStore } from "./artifact-store.ts";
import { markVersions } from "./mark-types.ts";
import {
  type DiscoveredArtifact,
  type DiscoveredProduct,
  type SourceCatalog,
  SourceContractError,
  SourceHttpError,
  type SourceResponseState,
  SourceTransportError,
} from "./source-catalog.ts";
import { applyTrademarkBatch } from "./trademark-application.ts";
import {
  type SourceProduct,
  streamTrademarkProjections,
  TrademarkSourceError,
} from "./trademark-projection.ts";
import { ArtifactArchiveError } from "./zip-artifact-xml.ts";

const supportedProducts = ["TRTYRAP", "TRTDXFAP"] as const;
const expectedFrequency: Record<SourceProduct, string> = {
  TRTDXFAP: "daily",
  TRTYRAP: "yearly",
};
const discoveryIntervalMs = 24 * 60 * 60 * 1000;
const discoveryInsertBatchSize = 250;
const interruptedDownloadError = "Download interrupted before verified bytes were retained";

type Database = postgres.Sql | postgres.TransactionSql;

interface ArtifactRow {
  applicationState: "applying" | "complete" | "needs_attention" | "pending";
  contentRevision: number;
  downloadState: "blocked" | "downloaded" | "downloading" | "pending";
  expectedBytes: string;
  filename: string;
  id: string;
  objectKey: string | null;
  parserVersion: string | null;
  product: SourceProduct;
  sha256: string | null;
  sourceFromDate: string;
  sourceToDate: string;
}

export interface TrademarkIngestionStatus {
  attentionCount: number;
  currentArtifact: {
    filename: string;
    state: "applying" | "discovering" | "downloading";
  } | null;
  dataVersion: number;
  lastSuccessfulUpdateAt: Date | null;
  latestProcessedDate: string | null;
  pendingArtifactCount: number;
  worker: {
    activity: "applying" | "discovering" | "downloading" | "idle";
    currentError: string | null;
    lastDiscoveryAt: Date | null;
    lastHeartbeatAt: Date | null;
    updatedAt: Date | null;
  };
}

export function createTrademarkIngestion(options: {
  artifactStore: ArtifactStore;
  database: postgres.Sql;
  extractXml: (archivePath: string) => Promise<import("node:stream").Readable>;
  now?: () => Date;
  sourceCatalog: SourceCatalog;
}) {
  const now = options.now ?? (() => new Date());

  async function heartbeat(
    activity: TrademarkIngestionStatus["worker"]["activity"] = "idle",
    currentFilename: string | null = null,
    currentError: string | null = null
  ) {
    await options.database`
      insert into worker_status (id, activity, current_filename, current_error, last_heartbeat_at, updated_at)
      values ('uspto', ${activity}, ${currentFilename}, ${currentError}, ${now()}, ${now()})
      on conflict (id) do update set activity = excluded.activity,
        current_filename = excluded.current_filename, current_error = excluded.current_error,
        last_heartbeat_at = excluded.last_heartbeat_at, updated_at = excluded.updated_at
    `;
  }

  async function cleanupArtifact(artifactId: string, objectKey: string) {
    await options.artifactStore.remove(objectKey);
    await options.database`
      update source_artifact set object_key = null, updated_at = ${now()}
      where id = ${artifactId} and object_key = ${objectKey}
    `;
  }

  async function tryCleanupCompletedArtifact(artifactId: string, objectKey: string) {
    try {
      await cleanupArtifact(artifactId, objectKey);
      return true;
    } catch (error) {
      console.error(`Completed artifact cleanup failed for ${artifactId}`, error);
      return false;
    }
  }

  async function cleanupOneObject() {
    const retained = new Set(
      (
        await options.database<Array<{ objectKey: string }>>`
          select object_key as "objectKey" from source_artifact where object_key is not null
        `
      ).map(({ objectKey }) => objectKey)
    );
    for await (const objectKey of options.artifactStore.listObjectKeys()) {
      if (!retained.has(objectKey)) {
        await options.artifactStore.remove(objectKey);
        return { action: "cleanup-orphan" as const, objectKey };
      }
    }
    const [artifact] = await options.database<Array<{ id: string; objectKey: string }>>`
      select id, object_key as "objectKey" from source_artifact
      where application_state = 'complete' and object_key is not null
      order by updated_at, filename limit 1
    `;
    if (!artifact) {
      return null;
    }
    return (await tryCleanupCompletedArtifact(artifact.id, artifact.objectKey))
      ? { action: "cleanup-artifact" as const, artifactId: artifact.id }
      : null;
  }

  async function recoverInterruptedDownload() {
    const [candidate] = await options.database<
      Array<{ expectedBytes: string; filename: string; id: string }>
    >`
      select expected_bytes::text as "expectedBytes", filename, id from source_artifact
      where download_state = 'downloading' and object_key is null
      order by source_to_date, source_from_date, filename limit 1
    `;
    if (!candidate) {
      return null;
    }
    const expectedBytes = Number(candidate.expectedBytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new Error(`Source artifact ${candidate.id} has an invalid expected byte count`);
    }
    const stored = await options.artifactStore.recoverPut(candidate.id, expectedBytes);
    return options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const [artifact] = await transaction<Array<{ filename: string; id: string }>>`
        select id, filename from source_artifact where id = ${candidate.id}
          and download_state = 'downloading' and object_key is null for update
      `;
      if (!artifact) {
        return null;
      }
      if (stored) {
        await transaction`
          update source_artifact set download_state = 'downloaded', application_state = 'pending',
            sha256 = ${stored.sha256}, bytes = ${stored.bytes}, object_key = ${stored.objectKey},
            current_error = null, downloaded_at = ${now()}, updated_at = ${now()}
          where id = ${artifact.id}
        `;
        return {
          action: "artifact-downloaded" as const,
          artifactId: artifact.id,
          filename: artifact.filename,
          sha256: stored.sha256,
        };
      }
      await transaction`
        update source_artifact set download_state = 'blocked', current_error = ${interruptedDownloadError},
          updated_at = ${now()} where id = ${artifact.id}
      `;
      await resolveCoveredArtifacts(transaction);
      return {
        action: "artifact-download-blocked" as const,
        artifactId: artifact.id,
        filename: artifact.filename,
        reason: interruptedDownloadError,
      };
    });
  }

  function reserveApplication() {
    return options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const [artifact] = await transaction<ArtifactRow[]>`
        select application_state as "applicationState", content_revision as "contentRevision",
          download_state as "downloadState", expected_bytes::text as "expectedBytes", filename, id,
          object_key as "objectKey", parser_version as "parserVersion", product, sha256,
          source_from_date::text as "sourceFromDate", source_to_date::text as "sourceToDate"
        from source_artifact
        where download_state = 'downloaded' and object_key is not null and sha256 is not null
          and application_state in ('pending', 'applying')
        order by source_to_date, source_from_date, filename limit 1 for update
      `;
      if (!artifact) {
        return null;
      }
      await transaction`
        update source_artifact set application_state = 'applying', current_error = null,
          updated_at = ${now()} where id = ${artifact.id}
      `;
      return { ...artifact, applicationState: "applying" as const };
    });
  }

  async function applyArtifact(artifact: ArtifactRow) {
    if (!(artifact.objectKey && artifact.sha256)) {
      throw new Error(`Source artifact ${artifact.id} has no retained ZIP`);
    }
    await heartbeat("applying", artifact.filename);
    const archivePath = await options.artifactStore.openFile(artifact.objectKey);
    const coordinate = {
      contentRevision: artifact.contentRevision,
      filename: artifact.filename,
      parserVersion: markVersions.projection,
      product: artifact.product,
      sha256: artifact.sha256,
    };
    let validation: Awaited<ReturnType<typeof streamTrademarkProjections>>;
    try {
      validation = await streamTrademarkProjections({
        coordinate,
        onBatch: async (batch) => ({
          appliedRecordCount: batch.length,
          firstError: null,
          materialChangeCount: 0,
          unresolvedRecordCount: 0,
        }),
        xml: await options.extractXml(archivePath),
      });
    } catch (error) {
      if (!(error instanceof ArtifactArchiveError || error instanceof TrademarkSourceError)) {
        throw error;
      }
      const reason = safeError(error);
      await options.database`
        update source_artifact set application_state = 'needs_attention', current_error = ${reason},
          parser_version = ${markVersions.projection}, updated_at = ${now()} where id = ${artifact.id}
      `;
      await heartbeat("idle");
      return {
        action: "artifact-needs-attention" as const,
        artifactId: artifact.id,
        filename: artifact.filename,
        reason,
      };
    }
    if (validation.physicalRecordCount === 0) {
      const reason = "Source artifact contains no physical records";
      await options.database`
        update source_artifact set application_state = 'needs_attention', current_error = ${reason},
          parser_version = ${markVersions.projection}, updated_at = ${now()} where id = ${artifact.id}
      `;
      await heartbeat("idle");
      return {
        action: "artifact-needs-attention" as const,
        artifactId: artifact.id,
        filename: artifact.filename,
        reason,
      };
    }

    const application = await streamTrademarkProjections({
      coordinate,
      onBatch: (batch) =>
        options.database.begin(async (transaction) => {
          await lockIngestion(transaction);
          return applyTrademarkBatch(transaction, batch, now());
        }),
      xml: await options.extractXml(archivePath),
    });
    const unresolvedRecordCount = Math.max(
      validation.unresolvedRecordCount,
      application.unresolvedRecordCount
    );
    const firstError = validation.firstError ?? application.firstError;
    const applicationState = unresolvedRecordCount === 0 ? "complete" : "needs_attention";
    await options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      await transaction`
        update source_artifact set application_state = ${applicationState},
          applied_record_count = ${application.appliedRecordCount},
          application_completed_at = ${now()}, current_error = ${firstError},
          parser_version = ${markVersions.projection},
          physical_record_count = ${application.physicalRecordCount},
          projected_mark_count = ${application.projectedMarkCount},
          unresolved_record_count = ${unresolvedRecordCount}, updated_at = ${now()}
        where id = ${artifact.id}
      `;
      if (applicationState === "complete") {
        await resolveCoveredArtifacts(transaction);
      }
    });
    if (applicationState === "complete") {
      await tryCleanupCompletedArtifact(artifact.id, artifact.objectKey);
    }
    await heartbeat("idle");
    return {
      action:
        applicationState === "complete"
          ? ("artifact-applied" as const)
          : ("artifact-needs-attention" as const),
      artifactId: artifact.id,
      filename: artifact.filename,
      ...application,
    };
  }

  function reserveDownload() {
    return options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const [artifact] = await transaction<ArtifactRow[]>`
        select application_state as "applicationState", content_revision as "contentRevision",
          download_state as "downloadState", expected_bytes::text as "expectedBytes", filename, id,
          object_key as "objectKey", parser_version as "parserVersion", product, sha256,
          source_from_date::text as "sourceFromDate", source_to_date::text as "sourceToDate"
        from source_artifact
        where processing_disposition = 'required' and download_state = 'pending'
        order by source_to_date, source_from_date, filename limit 1 for update
      `;
      if (!artifact) {
        return null;
      }
      await transaction`
        update source_artifact set download_state = 'downloading', current_error = null,
          download_request_count = download_request_count + 1, download_response_state = null,
          updated_at = ${now()} where id = ${artifact.id}
      `;
      return { ...artifact, downloadState: "downloading" as const };
    });
  }

  async function downloadArtifact(artifact: ArtifactRow) {
    await heartbeat("downloading", artifact.filename);
    const expectedBytes = Number(artifact.expectedBytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new Error(`Source artifact ${artifact.id} has an invalid expected byte count`);
    }
    try {
      const download = await options.sourceCatalog.download({
        filename: artifact.filename,
        product: artifact.product,
      });
      if (download.expectedBytes !== null && download.expectedBytes !== expectedBytes) {
        await download.body.cancel("Source response length changed from catalog metadata");
        throw new SourceContractError("Source response length changed from catalog metadata");
      }
      const stored = await options.artifactStore.put(download.body, expectedBytes, artifact.id);
      await options.database.begin(async (transaction) => {
        await lockIngestion(transaction);
        await transaction`
          update source_artifact set download_state = 'downloaded', application_state = 'pending',
            sha256 = ${stored.sha256}, bytes = ${stored.bytes}, object_key = ${stored.objectKey},
            current_error = null, download_response_state = ${transaction.json({ ...download.responseState })},
            downloaded_at = ${now()}, updated_at = ${now()}
          where id = ${artifact.id} and download_state = 'downloading'
        `;
      });
      await heartbeat("idle");
      return {
        action: "artifact-downloaded" as const,
        artifactId: artifact.id,
        filename: artifact.filename,
        sha256: stored.sha256,
      };
    } catch (error) {
      if (!isSourceDownloadFailure(error)) {
        throw error;
      }
      const observedAt = now();
      const reason = safeError(error);
      const responseState = storedSourceResponseState(error, observedAt);
      await options.database.begin(async (transaction) => {
        await lockIngestion(transaction);
        await transaction`
          update source_artifact set download_state = 'blocked', current_error = ${reason},
            download_response_state = ${responseState ? transaction.json({ ...responseState }) : null},
            updated_at = ${observedAt} where id = ${artifact.id}
        `;
        await resolveCoveredArtifacts(transaction);
      });
      await heartbeat("idle");
      return {
        action: "artifact-download-blocked" as const,
        artifactId: artifact.id,
        filename: artifact.filename,
        reason,
      };
    }
  }

  async function discoverIfDue() {
    const [worker] = await options.database<Array<{ lastDiscoveryAt: Date | null }>>`
      select last_discovery_at as "lastDiscoveryAt" from worker_status where id = 'uspto'
    `;
    if (
      worker?.lastDiscoveryAt &&
      worker.lastDiscoveryAt.getTime() + discoveryIntervalMs > now().getTime()
    ) {
      return null;
    }
    await heartbeat("discovering");
    try {
      const discovered: DiscoveredProduct[] = [];
      for (const product of supportedProducts) {
        // biome-ignore lint/performance/noAwaitInLoops: ODP permits one concurrent request per API key.
        discovered.push(await options.sourceCatalog.discover(product));
      }
      const artifactCount = await retainDiscovery(discovered);
      await options.database`
        update worker_status set activity = 'idle', current_error = null,
          last_discovery_at = ${now()}, last_heartbeat_at = ${now()}, updated_at = ${now()}
        where id = 'uspto'
      `;
      return { action: "discovered" as const, artifactCount };
    } catch (error) {
      await heartbeat("idle", null, safeError(error));
      throw error;
    }
  }

  function retainDiscovery(products: DiscoveredProduct[]) {
    const discovered = products.flatMap(validateProduct);
    return options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const retainedIdentities = await assertRetainedArtifactIdentities(transaction, discovered);
      const [inventory] = await transaction<Array<{ count: number }>>`
        select count(*)::int as count from source_artifact
      `;
      const bootstrap = inventory?.count === 0 ? bootstrapDisposition(discovered) : null;
      const [retainedBroad] = bootstrap
        ? []
        : await transaction<Array<{ complete: boolean; fromDate: string; toDate: string }>>`
            select source_from_date::text as "fromDate", source_to_date::text as "toDate",
              bool_and(application_state = 'complete') as complete
            from source_artifact where source_from_date < source_to_date
            group by source_from_date, source_to_date
            order by source_from_date, source_to_date desc limit 1
          `;
      const newArtifacts = discovered.filter(
        ({ artifact, product }) => !retainedIdentities.has(`${product}:${artifact.filename}`)
      );
      let retainedCount = 0;
      for (let offset = 0; offset < newArtifacts.length; offset += discoveryInsertBatchSize) {
        const rows = newArtifacts
          .slice(offset, offset + discoveryInsertBatchSize)
          .map(({ artifact, product }) => {
            const selected =
              bootstrap?.get(`${product}:${artifact.filename}`) ??
              retainedBroadDisposition(artifact, retainedBroad);
            return {
              expected_bytes: artifact.bytes,
              filename: artifact.filename,
              id: randomUUID(),
              processing_disposition: selected?.disposition ?? "required",
              product,
              selected_broad_from_date: selected?.broadFromDate ?? null,
              selected_broad_to_date: selected?.broadToDate ?? null,
              source_from_date: artifact.fromDate,
              source_to_date: artifact.toDate,
            };
          });
        // biome-ignore lint/performance/noAwaitInLoops: Catalog writes stay bounded and ordered under one ingestion lock.
        const inserted = await transaction<Array<{ id: string }>>`
          insert into source_artifact ${transaction(rows)}
          on conflict (product, filename) do nothing returning id
        `;
        retainedCount += inserted.length;
      }
      await resolveCoveredArtifacts(transaction);
      return retainedCount;
    });
  }

  async function reconcile() {
    const [worker] = await options.database<Array<{ currentError: string | null }>>`
      select current_error as "currentError" from worker_status where id = 'uspto'
    `;
    if (worker?.currentError) {
      return { action: "stopped" as const };
    }
    await heartbeat();
    try {
      const interrupted = await recoverInterruptedDownload();
      if (interrupted) {
        return interrupted;
      }
      const cleanup = await cleanupOneObject();
      if (cleanup) {
        return cleanup;
      }
      const application = await reserveApplication();
      if (application) {
        const result = await applyArtifact(application);
        return result;
      }
      const discovery = await discoverIfDue();
      if (discovery) {
        return discovery;
      }
      const download = await reserveDownload();
      if (download) {
        const result = await downloadArtifact(download);
        return result;
      }
      return { action: "idle" as const };
    } catch (error) {
      await heartbeat("idle", null, safeError(error));
      throw error;
    }
  }

  async function initialize() {
    await options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      await resolveCoveredArtifacts(transaction);
    });
    await heartbeat();
  }

  return {
    heartbeat,
    initialize,
    pulse: () =>
      options.database`
        update worker_status set last_heartbeat_at = ${now()}, updated_at = ${now()}
        where id = 'uspto'
      `,
    reconcile,
    status: () => readTrademarkIngestionStatus(options.database, now()),
  };
}

export async function readTrademarkIngestionStatus(
  database: Database,
  at = new Date()
): Promise<TrademarkIngestionStatus> {
  const [facts] = await database<
    Array<
      Omit<TrademarkIngestionStatus, "currentArtifact" | "worker"> & {
        activity: TrademarkIngestionStatus["worker"]["activity"] | null;
        currentError: string | null;
        currentFilename: string | null;
        lastDiscoveryAt: Date | null;
        lastHeartbeatAt: Date | null;
        workerUpdatedAt: Date | null;
      }
    >
  >`
    select count(artifact.id) filter (where artifact.processing_disposition = 'required'
        and (artifact.download_state = 'blocked'
          or artifact.application_state = 'needs_attention'))::int as "attentionCount",
      coalesce(state.version, 0)::int as "dataVersion",
      state.last_successful_update_at as "lastSuccessfulUpdateAt",
      max(artifact.source_to_date) filter (where artifact.applied_record_count > 0)::text
        as "latestProcessedDate",
      count(artifact.id) filter (where artifact.processing_disposition = 'required'
        and (artifact.download_state in ('pending', 'downloading')
          or (artifact.download_state = 'downloaded'
            and artifact.application_state in ('pending', 'applying'))))::int
        as "pendingArtifactCount",
      worker.activity, worker.current_error as "currentError",
      worker.current_filename as "currentFilename", worker.last_discovery_at as "lastDiscoveryAt",
      worker.last_heartbeat_at as "lastHeartbeatAt", worker.updated_at as "workerUpdatedAt"
    from (select 1) anchor
    left join data_state state on state.id = 'uspto'
    left join worker_status worker on worker.id = 'uspto'
    left join source_artifact artifact on true
    group by state.version, state.last_successful_update_at, worker.activity,
      worker.current_error, worker.current_filename, worker.last_discovery_at,
      worker.last_heartbeat_at, worker.updated_at
  `;
  if (!facts) {
    throw new Error("Trademark ingestion status is unavailable");
  }
  const activity = facts.activity ?? "idle";
  const heartbeatIsCurrent =
    facts.lastHeartbeatAt !== null &&
    at.getTime() - facts.lastHeartbeatAt.getTime() <= 5 * 60 * 1000;
  let currentArtifact: TrademarkIngestionStatus["currentArtifact"] = null;
  if (heartbeatIsCurrent && activity === "discovering") {
    currentArtifact = { filename: "USPTO source catalog", state: activity };
  } else if (heartbeatIsCurrent && facts.currentFilename && activity !== "idle") {
    currentArtifact = { filename: facts.currentFilename, state: activity };
  }
  return {
    attentionCount: facts.attentionCount,
    currentArtifact,
    dataVersion: facts.dataVersion,
    lastSuccessfulUpdateAt: facts.lastSuccessfulUpdateAt,
    latestProcessedDate: facts.latestProcessedDate,
    pendingArtifactCount: facts.pendingArtifactCount,
    worker: {
      activity,
      currentError: facts.currentError,
      lastDiscoveryAt: facts.lastDiscoveryAt,
      lastHeartbeatAt: facts.lastHeartbeatAt,
      updatedAt: facts.workerUpdatedAt,
    },
  };
}

function validateProduct(discovered: DiscoveredProduct) {
  const product = discovered.product.identifier as SourceProduct;
  if (
    !supportedProducts.includes(product) ||
    discovered.product.frequency.toLowerCase() !== expectedFrequency[product]
  ) {
    throw new SourceContractError("USPTO catalog returned an unsupported product contract");
  }
  const filenames = new Set<string>();
  return discovered.artifacts.map((artifact) => {
    if (filenames.has(artifact.filename)) {
      throw new SourceContractError(`USPTO catalog repeats ${product}/${artifact.filename}`);
    }
    filenames.add(artifact.filename);
    if (
      artifact.bytes <= 0 ||
      artifact.fromDate > artifact.toDate ||
      !artifact.downloadUrl.endsWith(`/${product}/${encodeURIComponent(artifact.filename)}`)
    ) {
      throw new SourceContractError(`USPTO catalog has invalid metadata for ${artifact.filename}`);
    }
    return { artifact, product };
  });
}

function retainedBroadDisposition(
  artifact: DiscoveredArtifact,
  broad: { complete: boolean; fromDate: string; toDate: string } | undefined
) {
  if (
    !broad ||
    artifact.fromDate < broad.fromDate ||
    artifact.toDate > broad.toDate ||
    (artifact.fromDate === broad.fromDate && artifact.toDate === broad.toDate)
  ) {
    return;
  }
  return {
    broadFromDate: broad.fromDate,
    broadToDate: broad.toDate,
    disposition: broad.complete ? ("covered" as const) : ("deferred" as const),
  };
}

function bootstrapDisposition(
  discovered: Array<{ artifact: DiscoveredArtifact; product: SourceProduct }>
) {
  const groups = new Map<string, typeof discovered>();
  for (const item of discovered) {
    const key = `${item.artifact.fromDate}:${item.artifact.toDate}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const [broad] = [...groups.values()].sort((left, right) => {
    const start = left[0]?.artifact.fromDate.localeCompare(right[0]?.artifact.fromDate ?? "") ?? 0;
    return start === 0
      ? (right[0]?.artifact.toDate.localeCompare(left[0]?.artifact.toDate ?? "") ?? 0)
      : start;
  });
  if (!broad?.[0]) {
    throw new SourceContractError("USPTO catalog contains no source files");
  }
  const broadFromDate = broad[0].artifact.fromDate;
  const broadToDate = broad[0].artifact.toDate;
  return new Map(
    discovered.map((item) => {
      const inBroadGroup =
        item.artifact.fromDate === broadFromDate && item.artifact.toDate === broadToDate;
      const disposition =
        inBroadGroup || item.artifact.toDate > broadToDate ? "required" : "deferred";
      return [
        `${item.product}:${item.artifact.filename}`,
        { broadFromDate, broadToDate, disposition },
      ];
    })
  );
}

async function assertRetainedArtifactIdentities(
  database: Database,
  discovered: Array<{ artifact: DiscoveredArtifact; product: SourceProduct }>
) {
  if (discovered.length === 0) {
    return new Set<string>();
  }
  const rows = await database<
    Array<{
      expectedBytes: string;
      filename: string;
      product: string;
      sourceFromDate: string;
      sourceToDate: string;
    }>
  >`
    select expected_bytes::text as "expectedBytes", filename, product,
      source_from_date::text as "sourceFromDate", source_to_date::text as "sourceToDate"
    from source_artifact
  `;
  const expected = new Map(
    discovered.map(({ artifact, product }) => [`${product}:${artifact.filename}`, artifact])
  );
  const retained = new Set<string>();
  for (const row of rows) {
    const identity = `${row.product}:${row.filename}`;
    const artifact = expected.get(identity);
    if (!artifact) {
      continue;
    }
    retained.add(identity);
    if (
      row.expectedBytes !== String(artifact.bytes) ||
      row.sourceFromDate !== artifact.fromDate ||
      row.sourceToDate !== artifact.toDate
    ) {
      throw new SourceContractError(
        `USPTO catalog changed retained identity for ${row.product}/${row.filename}`
      );
    }
  }
  return retained;
}

async function resolveCoveredArtifacts(database: Database) {
  await database`
    update source_artifact covered set processing_disposition = 'deferred', updated_at = now()
    where covered.processing_disposition = 'covered'
      and covered.selected_broad_from_date is not null
      and covered.selected_broad_to_date is not null
      and exists (
        select 1 from source_artifact broad
        where broad.source_from_date = covered.selected_broad_from_date
          and broad.source_to_date = covered.selected_broad_to_date
          and broad.application_state <> 'complete'
      )
  `;
  await database`
    update source_artifact deferred set processing_disposition = 'covered', updated_at = now()
    where deferred.processing_disposition = 'deferred'
      and deferred.selected_broad_from_date is not null
      and deferred.selected_broad_to_date is not null
      and not exists (
        select 1 from source_artifact broad
        where broad.source_from_date = deferred.selected_broad_from_date
          and broad.source_to_date = deferred.selected_broad_to_date
          and broad.application_state <> 'complete'
      )
  `;
  await database`
    with covering as (
      select distinct on (blocked.id) blocked.id,
        broad.source_from_date as broad_from_date, broad.source_to_date as broad_to_date
      from source_artifact blocked
      join source_artifact broad
        on broad.source_from_date <= blocked.source_from_date
        and broad.source_to_date >= blocked.source_to_date
      where blocked.processing_disposition = 'required'
        and blocked.download_state = 'blocked'
      group by blocked.id, broad.source_from_date, broad.source_to_date
      having bool_and(broad.application_state = 'complete')
      order by blocked.id, broad.source_from_date, broad.source_to_date desc
    )
    update source_artifact blocked set processing_disposition = 'covered',
      selected_broad_from_date = covering.broad_from_date,
      selected_broad_to_date = covering.broad_to_date, updated_at = now()
    from covering where blocked.id = covering.id
  `;
}

function storedSourceResponseState(error: unknown, observedAt: Date) {
  if (!(error instanceof SourceHttpError)) {
    return null;
  }
  const state: SourceResponseState = { ...error.responseState };
  const retryNotBefore = providerRetryNotBefore(state, observedAt);
  if (retryNotBefore) {
    state.observedAt = observedAt.toISOString();
    state.retryNotBefore = retryNotBefore.toISOString();
  }
  return state;
}

function providerRetryNotBefore(state: SourceResponseState, observedAt: Date) {
  const candidates: number[] = [];
  if (state.retryAfterSeconds !== undefined) {
    candidates.push(observedAt.getTime() + state.retryAfterSeconds * 1000);
  }
  if (state.retryAfter) {
    const seconds = Number(state.retryAfter);
    const value = Number.isFinite(seconds)
      ? observedAt.getTime() + seconds * 1000
      : Date.parse(state.retryAfter);
    if (Number.isFinite(value)) {
      candidates.push(value);
    }
  }
  if (state.rateLimitReset) {
    const reset = Number(state.rateLimitReset);
    if (Number.isFinite(reset)) {
      let value = observedAt.getTime() + reset * 1000;
      if (reset >= 1_000_000_000_000) {
        value = reset;
      } else if (reset >= 1_000_000_000) {
        value = reset * 1000;
      }
      candidates.push(value);
    }
  }
  return candidates.length === 0 ? null : new Date(Math.max(...candidates));
}

function isSourceDownloadFailure(error: unknown) {
  return (
    error instanceof ArtifactIntegrityError ||
    error instanceof SourceContractError ||
    error instanceof SourceHttpError ||
    error instanceof SourceTransportError
  );
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}
