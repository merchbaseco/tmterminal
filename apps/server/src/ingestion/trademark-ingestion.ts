import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { lockIngestion } from "../queries/ingestion-lock.ts";
import { annualBaselineV1Artifacts } from "./annual-baseline-v1.ts";
import { ArtifactIntegrityError, type ArtifactStore } from "./artifact-store.ts";
import {
  type DiscoveredArtifact,
  type DiscoveredProduct,
  type SourceCatalog,
  SourceContractError,
  SourceHttpError,
  SourceTransportError,
} from "./source-catalog.ts";
import {
  type MarkUpsertProjection,
  type SourceProduct,
  streamTrademarkProjections,
  type TrademarkProjection,
} from "./trademark-projection.ts";

const annualProduct = "TRTYRAP";
const dailyProduct = "TRTDXFAP";
const dailyProductTitle = "Trademark Full Text XML Data (No Images) – Daily Applications";
const annualBaselineFromDate = "1884-04-07";
const annualBaselineToDate = "2025-12-31";
const expectedAnnualArtifacts = 91;
const normalizationVersion = "uspto-normalization-v1";
const maxProviderAttempts = 8;
const statusEventInsertBatchSize = 250;
const dailyDiscoveryIntervalMs = 24 * 60 * 60 * 1000;
const interruptedDownloadError = "Download interrupted before retention";

type Database = postgres.Sql | postgres.TransactionSql;

interface ArtifactRow {
  filename: string;
  id: string;
  objectKey: string | null;
  product: SourceProduct;
  sha256: string | null;
  sourceToDate: string;
  state: "complete" | "downloading" | "failed" | "pending" | "projecting";
}

export interface TrademarkIngestionStatus {
  annualCompleteArtifactCount: number;
  annualProjectedMarkCount: number;
  completeThroughDate: string | null;
  currentArtifact: { filename: string; state: ArtifactRow["state"] } | null;
  dataVersion: number;
  expectedArtifactCount: number;
  failedArtifactCount: number;
  failedArtifactUpdatedAt: Date | null;
  lane: {
    currentError: string | null;
    failureCount: number;
    nextEligibleAt: Date | null;
    status: "backoff" | "ready" | "stopped";
    updatedAt: Date;
  };
  lastSuccessfulUpdateAt: Date | null;
  pendingArtifactCount: number;
}

export function createTrademarkIngestion(options: {
  artifactStore: ArtifactStore;
  database: postgres.Sql;
  extractXml: (archivePath: string) => Promise<import("node:stream").Readable>;
  now?: () => Date;
  retry: { baseMs: number; jitter: () => number; maxMs: number };
  sourceCatalog: SourceCatalog;
}) {
  const now = options.now ?? (() => new Date());

  async function cleanupArtifact(artifact: ArtifactRow) {
    if (!artifact.objectKey) {
      return;
    }
    await options.artifactStore.remove(artifact.objectKey);
    await options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      await transaction`
        update source_artifact set object_key = null, updated_at = ${now()}
        where id = ${artifact.id} and object_key = ${artifact.objectKey}
      `;
    });
  }

  async function cleanupOrphanArtifact() {
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
        return objectKey;
      }
    }
    return null;
  }

  async function recordProviderFailure(error: unknown, database: Database = options.database) {
    const at = now();
    const [lane] = await database<Array<{ failureCount: number }>>`
      select failure_count as "failureCount" from source_lane where id = 'uspto-odp'
    `;
    const failureCount = (lane?.failureCount ?? 0) + 1;
    const retryable = isRetryable(error) && failureCount < maxProviderAttempts;
    const permanent = !retryable;
    const delay = Math.min(options.retry.maxMs, options.retry.baseMs * 2 ** (failureCount - 1));
    const exponentialEligibility =
      at.getTime() + delay + Math.floor(delay * 0.2 * options.retry.jitter());
    const providerEligibility =
      error instanceof SourceHttpError ? (headerEligibility(error, at)?.getTime() ?? 0) : 0;
    const nextEligibleAt = retryable
      ? new Date(Math.max(exponentialEligibility, providerEligibility))
      : null;
    await database`
      insert into source_lane (id, status, failure_count, current_error, next_eligible_at, updated_at)
      values ('uspto-odp', ${permanent ? "stopped" : "backoff"}, ${failureCount}, ${safeError(error)}, ${nextEligibleAt}, ${at})
      on conflict (id) do update set status = excluded.status, failure_count = excluded.failure_count,
        current_error = excluded.current_error, next_eligible_at = excluded.next_eligible_at,
        updated_at = excluded.updated_at
    `;
    return { action: permanent ? ("provider-stopped" as const) : ("provider-backoff" as const) };
  }

  async function markProviderSuccess(database: Database, nextEligibleAt: Date | null = null) {
    await database`
      insert into source_lane (id, status, failure_count, current_error, next_eligible_at, updated_at)
      values ('uspto-odp', 'ready', 0, null, ${nextEligibleAt}, ${now()})
      on conflict (id) do update set status = 'ready', failure_count = 0, current_error = null,
        next_eligible_at = excluded.next_eligible_at, updated_at = excluded.updated_at
    `;
  }

  async function retainDiscoveredArtifacts(
    product: SourceProduct,
    artifacts: DiscoveredArtifact[]
  ) {
    const nextEligibleAt =
      product === dailyProduct ? new Date(now().getTime() + dailyDiscoveryIntervalMs) : null;
    const inserted = await options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      await assertRetainedArtifactIdentities(transaction, product, artifacts);
      const rows = await transaction<Array<{ id: string }>>`
        insert into source_artifact ${transaction(
          artifacts.map((artifact) => ({
            download_url: artifact.downloadUrl,
            expected_bytes: artifact.bytes,
            filename: artifact.filename,
            id: randomUUID(),
            product,
            source_from_date: artifact.fromDate,
            source_to_date: artifact.toDate,
          }))
        )}
        on conflict (product, filename) do nothing returning id
      `;
      await markProviderSuccess(transaction, nextEligibleAt);
      return rows;
    });
    return {
      action: "discovered" as const,
      artifactCount: inserted.length,
      product,
    };
  }

  async function assertRetainedArtifactIdentities(
    database: Database,
    product: SourceProduct,
    artifacts: DiscoveredArtifact[]
  ) {
    if (artifacts.length === 0) {
      return;
    }
    const expected = new Map(artifacts.map((artifact) => [artifact.filename, artifact]));
    const retained = await database<
      Array<{ downloadUrl: string; expectedBytes: string; filename: string }>
    >`
      select filename, download_url as "downloadUrl", expected_bytes::text as "expectedBytes"
      from source_artifact where product = ${product}
        and filename in ${database([...expected.keys()])}
    `;
    for (const artifact of retained) {
      const discovered = expected.get(artifact.filename);
      if (
        !discovered ||
        artifact.downloadUrl !== discovered.downloadUrl ||
        artifact.expectedBytes !== String(discovered.bytes)
      ) {
        throw new SourceContractError(
          `Source catalog changed retained artifact identity: ${artifact.filename}`
        );
      }
    }
  }

  async function retainSelectedArtifacts(product: SourceProduct, artifacts: DiscoveredArtifact[]) {
    try {
      return await retainDiscoveredArtifacts(product, artifacts);
    } catch (error) {
      if (error instanceof SourceContractError) {
        return recordProviderFailure(error);
      }
      throw error;
    }
  }

  function reserveDownload() {
    return options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const [artifact] = await transaction<ArtifactRow[]>`
        select id, filename, product, source_to_date::text as "sourceToDate", state,
          object_key as "objectKey", sha256
        from source_artifact where state = 'pending'
        order by source_from_date, product, filename limit 1
      `;
      if (!artifact) {
        return null;
      }
      await transaction`update source_artifact set state = 'downloading', current_error = null, updated_at = ${now()} where id = ${artifact.id}`;
      return artifact;
    });
  }

  async function downloadArtifact(artifact: ArtifactRow) {
    const [source] = await options.database<Array<{ downloadUrl: string; expectedBytes: string }>>`
      select download_url as "downloadUrl", expected_bytes::text as "expectedBytes" from source_artifact where id = ${artifact.id}
    `;
    if (!source) {
      throw new Error(`Reserved source artifact disappeared: ${artifact.id}`);
    }
    const expectedBytes = Number(source.expectedBytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new Error(`Source artifact ${artifact.id} has an invalid expected byte count`);
    }
    let stored: Awaited<ReturnType<ArtifactStore["put"]>>;
    try {
      const download = await options.sourceCatalog.download(source.downloadUrl);
      if (download.expectedBytes !== null && download.expectedBytes !== expectedBytes) {
        await download.body.cancel(
          "Source artifact response length changed from its catalog value"
        );
        throw new SourceContractError(
          "Source artifact response length changed from its catalog value"
        );
      }
      stored = await options.artifactStore.put(download.body, expectedBytes);
    } catch (error) {
      return options.database.begin(async (transaction) => {
        await lockIngestion(transaction);
        await transaction`
          update source_artifact set state = 'pending', current_error = ${safeError(error)}, updated_at = ${now()}
          where id = ${artifact.id}
        `;
        return recordProviderFailure(error, transaction);
      });
    }
    await options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      await transaction`
        update source_artifact set state = 'projecting', sha256 = ${stored.sha256}, bytes = ${stored.bytes},
          object_key = ${stored.objectKey}, current_error = null, updated_at = ${now()}
        where id = ${artifact.id} and state = 'downloading'
      `;
      await markProviderSuccess(transaction);
    });
    return {
      action: "downloaded" as const,
      artifactId: artifact.id,
      filename: artifact.filename,
      sha256: stored.sha256,
    };
  }

  async function projectArtifact(artifact: ArtifactRow) {
    if (!(artifact.objectKey && artifact.sha256)) {
      throw new Error(`Source artifact ${artifact.id} has no retained ZIP`);
    }
    const { sha256 } = artifact;
    let result: Awaited<ReturnType<typeof streamTrademarkProjections>>;
    try {
      const archivePath = await options.artifactStore.openFile(artifact.objectKey);
      result = await options.database.begin(async (transaction) => {
        await lockIngestion(transaction);
        const removed = await transaction<Array<{ serialNumber: string }>>`
          delete from mark where source_product = ${artifact.product}
            and source_filename = ${artifact.filename}
          returning serial_number as "serialNumber"
        `;
        const parsed = await streamTrademarkProjections({
          coordinate: {
            filename: artifact.filename,
            product: artifact.product,
            sha256,
          },
          onBatch: (batch) => insertProjectionBatch(transaction, batch),
          xml: await options.extractXml(archivePath),
        });
        if (parsed.physicalRecordCount === 0) {
          throw new Error("Source artifact contains no physical records");
        }
        await transaction`
          update source_artifact set state = 'complete', physical_record_count = ${parsed.physicalRecordCount},
            projected_mark_count = ${parsed.projectedMarkCount}, completed_at = ${now()}, current_error = null,
            updated_at = ${now()} where id = ${artifact.id}
        `;
        const materialChangeCount = parsed.materialChangeCount + removed.length;
        const [coverage] = await transaction<Array<{ completeThroughDate: string | null }>>`
          select case
            when count(*) filter (where product = ${annualProduct} and state = 'complete') = ${expectedAnnualArtifacts}
              then coalesce(max(source_to_date) filter (where product = ${dailyProduct} and state = 'complete'), ${annualBaselineToDate}::date)::text
            else null
          end as "completeThroughDate"
          from source_artifact
        `;
        await transaction`
          insert into data_state (id, version, complete_through_date, last_successful_update_at)
          values ('uspto', ${materialChangeCount > 0 ? 1 : 0}, ${coverage?.completeThroughDate ?? null}, ${now()})
          on conflict (id) do update set
            version = data_state.version + ${materialChangeCount > 0 ? 1 : 0},
            complete_through_date = excluded.complete_through_date,
            last_successful_update_at = excluded.last_successful_update_at
        `;
        return { ...parsed, materialChangeCount };
      });
    } catch (error) {
      await options.database.begin(async (transaction) => {
        await lockIngestion(transaction);
        await transaction`
          update source_artifact set state = 'failed', current_error = ${safeError(error)}, updated_at = ${now()}
          where id = ${artifact.id}
        `;
      });
      await cleanupArtifact(artifact);
      return {
        action: "artifact-failed" as const,
        artifactId: artifact.id,
        filename: artifact.filename,
        reason: safeError(error),
      };
    }
    await cleanupArtifact(artifact);
    return {
      action: "projected" as const,
      artifactId: artifact.id,
      filename: artifact.filename,
      ...result,
    };
  }

  async function reconcileLocalState() {
    await options.database`
        insert into source_lane (id, status) values ('uspto-odp', 'ready') on conflict (id) do nothing
      `;
    const orphanObjectKey = await cleanupOrphanArtifact();
    if (orphanObjectKey) {
      return { action: "cleanup-orphan" as const, objectKey: orphanObjectKey };
    }
    const [cleanup] = await options.database<ArtifactRow[]>`
        select id, filename, product, source_to_date::text as "sourceToDate", state,
          object_key as "objectKey", sha256
        from source_artifact where object_key is not null and state in ('complete', 'failed') order by filename limit 1
      `;
    if (cleanup) {
      await cleanupArtifact(cleanup);
      return { action: "cleanup" as const, artifactId: cleanup.id };
    }
    const interrupted = await options.database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const [artifact] = await transaction<ArtifactRow[]>`
        select id, filename, product, source_to_date::text as "sourceToDate", state,
          object_key as "objectKey", sha256
        from source_artifact where state = 'downloading' and object_key is null
        order by filename limit 1 for update
      `;
      if (!artifact) {
        return null;
      }
      await transaction`
        update source_artifact set state = 'failed', current_error = ${interruptedDownloadError}, updated_at = ${now()}
        where id = ${artifact.id}
      `;
      return artifact;
    });
    if (interrupted) {
      return {
        action: "artifact-failed" as const,
        artifactId: interrupted.id,
        filename: interrupted.filename,
        reason: interruptedDownloadError,
      };
    }
    const [failed] = await options.database<Array<ArtifactRow & { currentError: string | null }>>`
      select id, filename, product, source_to_date::text as "sourceToDate", state,
        object_key as "objectKey", sha256, current_error as "currentError"
      from source_artifact where state = 'failed' order by source_from_date, product, filename limit 1
    `;
    if (failed) {
      return {
        action: "artifact-failed" as const,
        artifactId: failed.id,
        filename: failed.filename,
        reason: failed.currentError ?? "Source artifact failed",
      };
    }
    const [projecting] = await options.database<ArtifactRow[]>`
        select id, filename, product, source_to_date::text as "sourceToDate", state,
          object_key as "objectKey", sha256
        from source_artifact where state = 'projecting'
        order by source_from_date, product, filename limit 1
      `;
    return projecting ? projectArtifact(projecting) : null;
  }

  async function discoverNextArtifacts(lane: { nextEligibleAt: Date | null } | undefined) {
    const [inventory] = await options.database<
      Array<{ annualComplete: number; annualTotal: number }>
    >`
        select count(*) filter (where product = ${annualProduct})::int as "annualTotal",
          count(*) filter (where product = ${annualProduct} and state = 'complete')::int as "annualComplete"
        from source_artifact
      `;
    if (!inventory?.annualTotal) {
      try {
        const artifacts = selectAnnualArtifacts(
          await options.sourceCatalog.discover(annualProduct)
        );
        return retainSelectedArtifacts(annualProduct, artifacts);
      } catch (error) {
        return recordProviderFailure(error);
      }
    }
    if (
      inventory.annualComplete !== expectedAnnualArtifacts ||
      (lane?.nextEligibleAt && lane.nextEligibleAt > now())
    ) {
      return { action: "idle" as const };
    }
    try {
      const [state] = await options.database<Array<{ completeThroughDate: string | null }>>`
        select complete_through_date::text as "completeThroughDate"
        from data_state where id = 'uspto'
      `;
      if (!state?.completeThroughDate) {
        throw new Error("Daily discovery requires durable complete-through coverage");
      }
      const artifacts = selectDailyArtifacts(
        await options.sourceCatalog.discover(dailyProduct),
        state.completeThroughDate
      );
      return retainSelectedArtifacts(dailyProduct, artifacts);
    } catch (error) {
      return recordProviderFailure(error);
    }
  }

  async function reconcile() {
    const localAction = await reconcileLocalState();
    if (localAction) {
      return localAction;
    }
    const [lane] = await options.database<Array<{ nextEligibleAt: Date | null; status: string }>>`
      select status, next_eligible_at as "nextEligibleAt" from source_lane where id = 'uspto-odp'
    `;
    if (lane?.status === "stopped") {
      return { action: "provider-stopped" as const };
    }
    if (lane?.status === "backoff" && lane.nextEligibleAt && lane.nextEligibleAt > now()) {
      return { action: "provider-backoff" as const };
    }
    const artifact = await reserveDownload();
    return artifact ? downloadArtifact(artifact) : discoverNextArtifacts(lane);
  }

  return {
    reconcile,
    status: () => readTrademarkIngestionStatus(options.database),
  };
}

export async function readTrademarkIngestionStatus(
  database: Database
): Promise<TrademarkIngestionStatus> {
  const [status] = await database<TrademarkIngestionStatus[]>`
    select
      count(artifact.id) filter (where artifact.product = ${annualProduct} and artifact.state = 'complete')::int as "annualCompleteArtifactCount",
      coalesce(sum(artifact.projected_mark_count) filter (where artifact.product = ${annualProduct}), 0)::int as "annualProjectedMarkCount",
      state.complete_through_date::text as "completeThroughDate",
      coalesce(state.version, 0)::int as "dataVersion",
      ${expectedAnnualArtifacts}::int as "expectedArtifactCount",
      count(artifact.id) filter (where artifact.state = 'failed')::int as "failedArtifactCount",
      min(artifact.updated_at) filter (where artifact.state = 'failed') as "failedArtifactUpdatedAt",
      state.last_successful_update_at as "lastSuccessfulUpdateAt",
      count(artifact.id) filter (where artifact.state in ('pending', 'downloading', 'projecting'))::int as "pendingArtifactCount"
    from (select 1) anchor
    left join data_state state on state.id = 'uspto'
    left join source_artifact artifact on true
    group by state.complete_through_date, state.version, state.last_successful_update_at
  `;
  const [lane] = await database<TrademarkIngestionStatus["lane"][]>`
    select lane.current_error as "currentError", coalesce(lane.failure_count, 0)::int as "failureCount",
      lane.next_eligible_at as "nextEligibleAt", coalesce(lane.status, 'ready') as status,
      coalesce(lane.updated_at, to_timestamp(0)) as "updatedAt"
    from (select 1) anchor left join source_lane lane on lane.id = 'uspto-odp'
  `;
  const [currentArtifact] = await database<
    Array<{ filename: string; state: ArtifactRow["state"] }>
  >`
    select filename, state from source_artifact where state in ('downloading', 'projecting') order by filename limit 1
  `;
  if (!(status && lane)) {
    throw new Error("Trademark ingestion status is unavailable");
  }
  return { ...status, currentArtifact: currentArtifact ?? null, lane };
}

async function insertProjectionBatch(database: Database, batch: TrademarkProjection[]) {
  let materialChangeCount = 0;
  const removals = batch.filter((projection) => projection.kind === "remove");
  const removalsByDate = new Map<string | null, string[]>();
  for (const removal of removals) {
    const serials = removalsByDate.get(removal.sourceTransactionDate) ?? [];
    serials.push(removal.serialNumber);
    removalsByDate.set(removal.sourceTransactionDate, serials);
  }
  const removalResults = await Promise.all(
    [...removalsByDate].map(([sourceTransactionDate, serials]) =>
      sourceTransactionDate
        ? database<Array<{ serialNumber: string }>>`
          delete from mark where serial_number in ${database(serials)}
            and (source_transaction_date is null or source_transaction_date < ${sourceTransactionDate})
          returning serial_number as "serialNumber"
        `
        : Promise.resolve([])
    )
  );
  materialChangeCount += removalResults.reduce((count, removed) => count + removed.length, 0);

  const upserts = batch.filter(
    (projection): projection is MarkUpsertProjection & { kind: "upsert" } =>
      projection.kind === "upsert"
  );
  if (upserts.length === 0) {
    return materialChangeCount;
  }
  const source = (projection: MarkUpsertProjection) => ({
    source_filename: projection.coordinate.filename,
    source_physical_record_index: projection.coordinate.physicalRecordIndex,
    source_product: projection.coordinate.product,
    source_sha256: projection.coordinate.sha256,
  });
  const acceptedRows = await database<Array<{ serialNumber: string }>>`
    insert into mark ${database(
      upserts.map((projection) => ({
        filing_date: projection.filingDate,
        mark_drawing_code: projection.markDrawingCode,
        normalization_version: normalizationVersion,
        registration_date: projection.registrationDate,
        registration_number: projection.registrationNumber,
        serial_number: projection.serialNumber,
        source_transaction_date: projection.sourceTransactionDate,
        status_code: projection.statusCode,
        status_date: projection.statusDate,
        word_mark: projection.wordMark,
        ...source(projection),
      }))
    )}
    on conflict (serial_number) do update set
      filing_date = excluded.filing_date,
      mark_drawing_code = excluded.mark_drawing_code,
      normalization_version = excluded.normalization_version,
      registration_date = excluded.registration_date,
      registration_number = excluded.registration_number,
      source_filename = excluded.source_filename,
      source_physical_record_index = excluded.source_physical_record_index,
      source_product = excluded.source_product,
      source_sha256 = excluded.source_sha256,
      source_transaction_date = excluded.source_transaction_date,
      status_code = excluded.status_code,
      status_date = excluded.status_date,
      word_mark = excluded.word_mark
    where excluded.source_transaction_date is not null
      and (mark.source_transaction_date is null
        or excluded.source_transaction_date > mark.source_transaction_date)
    returning serial_number as "serialNumber"
  `;
  materialChangeCount += acceptedRows.length;
  if (acceptedRows.length === 0) {
    return materialChangeCount;
  }
  const acceptedSerials = acceptedRows.map(({ serialNumber }) => serialNumber);
  await database`delete from mark_class where serial_number in ${database(acceptedSerials)}`;
  await database`delete from mark_owner where serial_number in ${database(acceptedSerials)}`;
  await database`delete from mark_goods_services where serial_number in ${database(acceptedSerials)}`;
  await database`delete from mark_status_event where serial_number in ${database(acceptedSerials)}`;
  const accepted = new Set(acceptedSerials);
  const projections = upserts.filter((projection) => accepted.has(projection.serialNumber));
  const classes = projections.flatMap((projection) =>
    projection.classes.map((item, index) => ({
      international_code: item.internationalCode,
      ordinal: index + 1,
      serial_number: projection.serialNumber,
      status_code: item.statusCode,
      status_date: item.statusDate,
      ...source(projection),
    }))
  );
  const owners = projections.flatMap((projection) =>
    projection.owners.map((item, index) => ({
      entry_number: item.entryNumber,
      ordinal: index + 1,
      party_name: item.partyName,
      party_type: item.partyType,
      serial_number: projection.serialNumber,
      ...source(projection),
    }))
  );
  const goods = projections.flatMap((projection) =>
    projection.goodsServices.map((item, index) => ({
      ordinal: index + 1,
      serial_number: projection.serialNumber,
      text: item.text,
      type_code: item.typeCode,
      ...source(projection),
    }))
  );
  const events = projections.flatMap((projection) =>
    projection.statusEvents.map((item) => ({
      code: item.code,
      description: item.description,
      event_date: item.date,
      event_key: item.eventKey,
      event_number: item.number,
      serial_number: projection.serialNumber,
      type: item.type,
      ...source(projection),
    }))
  );
  if (classes.length > 0) {
    await database`insert into mark_class ${database(classes)}`;
  }
  if (owners.length > 0) {
    await database`insert into mark_owner ${database(owners)}`;
  }
  if (goods.length > 0) {
    await database`insert into mark_goods_services ${database(goods)}`;
  }
  if (events.length > 0) {
    for (let offset = 0; offset < events.length; offset += statusEventInsertBatchSize) {
      // biome-ignore lint/performance/noAwaitInLoops: Artifact projection writes stay ordered inside one transaction.
      await database`insert into mark_status_event ${database(events.slice(offset, offset + statusEventInsertBatchSize))}`;
    }
  }
  return materialChangeCount;
}

function isRetryable(error: unknown) {
  if (error instanceof SourceHttpError) {
    return (
      [408, 425, 429].includes(error.responseState.status) || error.responseState.status >= 500
    );
  }
  return error instanceof SourceTransportError || error instanceof ArtifactIntegrityError;
}

function selectAnnualArtifacts(discovered: DiscoveredProduct) {
  if (
    discovered.product.identifier !== annualProduct ||
    discovered.product.frequency.toLowerCase() !== "yearly"
  ) {
    throw new SourceContractError("Annual catalog returned the wrong product contract");
  }
  const byFilename = new Map(discovered.artifacts.map((artifact) => [artifact.filename, artifact]));
  if (byFilename.size !== discovered.artifacts.length) {
    throw new SourceContractError("Annual catalog contains duplicate filenames");
  }
  const artifacts = annualBaselineV1Artifacts.map((filename) => {
    const artifact = byFilename.get(filename);
    if (
      !artifact ||
      artifact.fromDate !== annualBaselineFromDate ||
      artifact.toDate !== annualBaselineToDate
    ) {
      throw new SourceContractError(`Annual catalog is missing pinned member ${filename}`);
    }
    return artifact;
  });
  if (artifacts.length !== expectedAnnualArtifacts) {
    throw new SourceContractError("Annual baseline must contain 91 members");
  }
  return artifacts;
}

function selectDailyArtifacts(discovered: DiscoveredProduct, completeThroughDate: string) {
  if (
    discovered.product.identifier !== dailyProduct ||
    discovered.product.title !== dailyProductTitle ||
    discovered.product.frequency.toLowerCase() !== "daily"
  ) {
    throw new SourceContractError("Daily catalog returned the wrong product contract");
  }
  const filenames = new Set<string>();
  const artifacts = discovered.artifacts
    .filter((artifact) => artifact.fromDate > annualBaselineToDate)
    .sort((left, right) => left.fromDate.localeCompare(right.fromDate));
  for (const artifact of artifacts) {
    if (filenames.has(artifact.filename)) {
      throw new SourceContractError("Daily catalog contains duplicate filenames");
    }
    filenames.add(artifact.filename);
    if (
      artifact.toDate !== artifact.fromDate ||
      artifact.filename !== dailyFilename(artifact.fromDate)
    ) {
      throw new SourceContractError(
        `Daily catalog member has invalid identity: ${artifact.filename}`
      );
    }
  }
  let expectedDate = nextDate(completeThroughDate);
  const newerArtifacts = artifacts.filter((artifact) => artifact.fromDate >= expectedDate);
  for (const artifact of newerArtifacts) {
    if (artifact.fromDate !== expectedDate) {
      throw new SourceContractError(`Daily catalog is not contiguous at ${expectedDate}`);
    }
    expectedDate = nextDate(expectedDate);
  }
  return artifacts;
}

function dailyFilename(date: string) {
  return `apc${date.slice(2).replaceAll("-", "")}.zip`;
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function headerEligibility(error: SourceHttpError, now: Date) {
  const candidates: number[] = [];
  const { rateLimitReset, retryAfter } = error.responseState;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const value = Number.isFinite(seconds)
      ? now.getTime() + seconds * 1000
      : Date.parse(retryAfter);
    if (Number.isFinite(value)) {
      candidates.push(value);
    }
  }
  if (rateLimitReset) {
    const reset = Number(rateLimitReset);
    if (Number.isFinite(reset)) {
      let value = now.getTime() + reset * 1000;
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

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}
