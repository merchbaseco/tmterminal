import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { lockCorpusBuild } from "../queries/corpus-build-lock.ts";
import { annualGenerationV1Artifacts } from "./annual-generation-v1.ts";
import { type AnnualMarkProjection, streamAnnualProjections } from "./annual-projection.ts";
import { ArtifactIntegrityError, type ArtifactStore } from "./artifact-store.ts";
import {
  type DiscoveredArtifact,
  type DiscoveredProduct,
  type SourceCatalog,
  SourceContractError,
  SourceHttpError,
  SourceTransportError,
} from "./source-catalog.ts";

const annualProduct = "TRTYRAP";
const generationFromDate = "1884-04-07";
const generationToDate = "2025-12-31";
const expectedArtifacts = 91;
const normalizationVersion = "uspto-normalization-v1";
const maxProviderAttempts = 8;
const interruptedDownloadError = "Download interrupted before retention";

type Database = postgres.Sql | postgres.TransactionSql;

interface ArtifactRow {
  filename: string;
  generationId: string;
  id: string;
  objectKey: string | null;
  sha256: string | null;
  state: "complete" | "downloading" | "failed" | "pending" | "projecting";
}

export interface AnnualCorpusStatus {
  activeGenerationId: string | null;
  completeArtifactCount: number;
  completeThroughDate: string | null;
  corpusVersion: number;
  currentArtifact: { filename: string; state: ArtifactRow["state"] } | null;
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
  lastSuccessfulMergeAt: Date | null;
  pendingArtifactCount: number;
  projectedMarkCount: number;
  publishedThroughDate: string | null;
}

export function createAnnualCorpusIngestion(options: {
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
      await lockCorpusBuild(transaction);
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

  async function markProviderSuccess(database: Database) {
    await database`
      insert into source_lane (id, status, failure_count, current_error, next_eligible_at, updated_at)
      values ('uspto-odp', 'ready', 0, null, null, ${now()})
      on conflict (id) do update set status = 'ready', failure_count = 0, current_error = null,
        next_eligible_at = null, updated_at = excluded.updated_at
    `;
  }

  async function discoverGeneration(artifacts: DiscoveredArtifact[]) {
    const generationId = randomUUID();
    await options.database.begin(async (transaction) => {
      await lockCorpusBuild(transaction);
      const [existing] =
        await transaction`select id from corpus_generation where state = 'building' limit 1`;
      if (existing) {
        await markProviderSuccess(transaction);
        return;
      }
      await transaction`
        insert into corpus_generation (id, product, from_date, to_date, expected_artifact_count)
        values (${generationId}, ${annualProduct}, ${generationFromDate}, ${generationToDate}, ${expectedArtifacts})
      `;
      await transaction`insert into source_artifact ${transaction(
        artifacts.map((artifact) => ({
          download_url: artifact.downloadUrl,
          expected_bytes: artifact.bytes,
          filename: artifact.filename,
          generation_id: generationId,
          id: randomUUID(),
          product: annualProduct,
          source_from_date: artifact.fromDate,
          source_to_date: artifact.toDate,
        }))
      )}`;
      await markProviderSuccess(transaction);
    });
    return { action: "discovered" as const, artifactCount: artifacts.length, generationId };
  }

  function reserveDownload() {
    return options.database.begin(async (transaction) => {
      await lockCorpusBuild(transaction);
      const [artifact] = await transaction<ArtifactRow[]>`
        select id, generation_id as "generationId", filename, state, object_key as "objectKey", sha256
        from source_artifact where state = 'pending' order by filename limit 1
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
      throw new Error(`Reserved annual artifact disappeared: ${artifact.id}`);
    }
    const expectedBytes = Number(source.expectedBytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new Error(`Annual artifact ${artifact.id} has an invalid expected byte count`);
    }
    let stored: Awaited<ReturnType<ArtifactStore["put"]>>;
    try {
      const download = await options.sourceCatalog.download(source.downloadUrl);
      if (download.expectedBytes !== null && download.expectedBytes !== expectedBytes) {
        await download.body.cancel(
          "Annual artifact response length changed from its catalog value"
        );
        throw new SourceContractError(
          "Annual artifact response length changed from its catalog value"
        );
      }
      stored = await options.artifactStore.put(download.body, expectedBytes);
    } catch (error) {
      return options.database.begin(async (transaction) => {
        await lockCorpusBuild(transaction);
        await transaction`
          update source_artifact set state = 'pending', current_error = ${safeError(error)}, updated_at = ${now()}
          where id = ${artifact.id}
        `;
        return recordProviderFailure(error, transaction);
      });
    }
    await options.database.begin(async (transaction) => {
      await lockCorpusBuild(transaction);
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
      throw new Error(`Annual artifact ${artifact.id} has no retained ZIP`);
    }
    const { sha256 } = artifact;
    let result: Awaited<ReturnType<typeof streamAnnualProjections>>;
    try {
      const archivePath = await options.artifactStore.openFile(artifact.objectKey);
      result = await options.database.begin(async (transaction) => {
        await lockCorpusBuild(transaction);
        await transaction`
          delete from mark where generation_id = ${artifact.generationId} and source_filename = ${artifact.filename}
        `;
        const parsed = await streamAnnualProjections({
          coordinate: {
            filename: artifact.filename,
            product: annualProduct,
            sha256,
          },
          onBatch: (batch) => insertProjectionBatch(transaction, artifact.generationId, batch),
          xml: await options.extractXml(archivePath),
        });
        if (parsed.physicalRecordCount === 0) {
          throw new Error("Annual artifact contains no physical records");
        }
        await transaction`
          update source_artifact set state = 'complete', physical_record_count = ${parsed.physicalRecordCount},
            projected_mark_count = ${parsed.projectedMarkCount}, completed_at = ${now()}, current_error = null,
            updated_at = ${now()} where id = ${artifact.id}
        `;
        return parsed;
      });
    } catch (error) {
      await options.database.begin(async (transaction) => {
        await lockCorpusBuild(transaction);
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

  function activateGeneration() {
    return options.database.begin(async (transaction) => {
      await lockCorpusBuild(transaction);
      const [generation] = await transaction<
        Array<{
          completeCount: number;
          expectedCount: number;
          id: string;
          markCount: number;
          totalCount: number;
        }>
      >`
        select generation.id, generation.state,
          generation.expected_artifact_count::int as "expectedCount",
          count(artifact.id) filter (where artifact.state = 'complete')::int as "completeCount",
          count(artifact.id)::int as "totalCount",
          (select count(*)::int from mark where generation_id = generation.id) as "markCount"
        from corpus_generation generation
        left join source_artifact artifact on artifact.generation_id = generation.id
        where generation.state = 'building'
        group by generation.id
        limit 1
      `;
      if (
        !generation ||
        generation.expectedCount !== expectedArtifacts ||
        generation.completeCount !== expectedArtifacts ||
        generation.totalCount !== expectedArtifacts
      ) {
        return null;
      }
      if (generation.markCount === 0) {
        throw new Error("Complete annual generation contains no Class 025 marks");
      }
      const [state] = await transaction<Array<{ corpusVersion: number }>>`
        insert into corpus_state (id, corpus_version) values ('uspto', 0)
        on conflict (id) do update set id = excluded.id
        returning corpus_version::int as "corpusVersion"
      `;
      const corpusVersion = (state?.corpusVersion ?? 0) + 1;
      const activatedAt = now();
      await transaction`update corpus_generation set state = 'active', activated_at = ${activatedAt} where id = ${generation.id}`;
      await transaction`
        update corpus_state set current_generation_id = ${generation.id}, corpus_version = ${corpusVersion},
          complete_through_date = ${generationToDate}, published_through_date = ${generationToDate},
          last_successful_merge_at = ${activatedAt} where id = 'uspto'
      `;
      const eventId = randomUUID();
      await transaction`
        insert into corpus_event (id, generation_id, corpus_version, kind, payload)
        values (${eventId}, ${generation.id}, ${corpusVersion}, 'generation-activated',
          ${transaction.json({ artifactCount: expectedArtifacts, completeThroughDate: generationToDate, markCount: generation.markCount })})
      `;
      await transaction`select pg_notify('corpus_events', ${eventId})`;
      return {
        action: "activated" as const,
        corpusVersion,
        generationId: generation.id,
        markCount: generation.markCount,
      };
    });
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
        select id, generation_id as "generationId", filename, state, object_key as "objectKey", sha256
        from source_artifact where object_key is not null and state in ('complete', 'failed') order by filename limit 1
      `;
    if (cleanup) {
      await cleanupArtifact(cleanup);
      return { action: "cleanup" as const, artifactId: cleanup.id };
    }
    const interrupted = await options.database.begin(async (transaction) => {
      await lockCorpusBuild(transaction);
      const [artifact] = await transaction<ArtifactRow[]>`
        select id, generation_id as "generationId", filename, state, object_key as "objectKey", sha256
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
      select artifact.id, artifact.generation_id as "generationId", artifact.filename,
        artifact.state, artifact.object_key as "objectKey", artifact.sha256,
        artifact.current_error as "currentError"
      from source_artifact artifact
      join corpus_generation generation on generation.id = artifact.generation_id
      where generation.state = 'building' and artifact.state = 'failed'
      order by artifact.filename limit 1
    `;
    if (failed) {
      return {
        action: "artifact-failed" as const,
        artifactId: failed.id,
        filename: failed.filename,
        reason: failed.currentError ?? "Annual artifact failed",
      };
    }
    const activated = await activateGeneration();
    if (activated) {
      return activated;
    }
    const [projecting] = await options.database<ArtifactRow[]>`
        select id, generation_id as "generationId", filename, state, object_key as "objectKey", sha256
        from source_artifact where state = 'projecting' order by filename limit 1
      `;
    return projecting ? projectArtifact(projecting) : null;
  }

  return {
    async reconcile() {
      const localAction = await reconcileLocalState();
      if (localAction) {
        return localAction;
      }
      const [generation] =
        await options.database`select id from corpus_generation where state = 'building' limit 1`;
      const [lane] = await options.database<Array<{ nextEligibleAt: Date | null; status: string }>>`
        select status, next_eligible_at as "nextEligibleAt" from source_lane where id = 'uspto-odp'
      `;
      if (lane?.status === "stopped") {
        return { action: "provider-stopped" as const };
      }
      if (lane?.nextEligibleAt && lane.nextEligibleAt > now()) {
        return { action: "provider-backoff" as const };
      }
      if (!generation) {
        const [active] =
          await options.database`select id from corpus_generation where state = 'active' limit 1`;
        if (active) {
          return { action: "idle" as const };
        }
        let artifacts: DiscoveredArtifact[];
        try {
          artifacts = selectAnnualArtifacts(await options.sourceCatalog.discover(annualProduct));
        } catch (error) {
          return recordProviderFailure(error);
        }
        return discoverGeneration(artifacts);
      }
      const artifact = await reserveDownload();
      if (artifact) {
        return downloadArtifact(artifact);
      }
      return { action: "idle" as const };
    },
    status: () => readAnnualCorpusStatus(options.database),
  };
}

export async function readAnnualCorpusStatus(database: Database): Promise<AnnualCorpusStatus> {
  const [status] = await database<AnnualCorpusStatus[]>`
    select
      state.current_generation_id as "activeGenerationId",
      count(artifact.id) filter (where artifact.state = 'complete')::int as "completeArtifactCount",
      state.complete_through_date::text as "completeThroughDate",
      coalesce(state.corpus_version, 0)::int as "corpusVersion",
      coalesce(generation.expected_artifact_count, ${expectedArtifacts})::int as "expectedArtifactCount",
      count(artifact.id) filter (where artifact.state = 'failed')::int as "failedArtifactCount",
      min(artifact.updated_at) filter (where artifact.state = 'failed') as "failedArtifactUpdatedAt",
      state.last_successful_merge_at as "lastSuccessfulMergeAt",
      count(artifact.id) filter (where artifact.state in ('pending', 'downloading', 'projecting'))::int as "pendingArtifactCount",
      coalesce(sum(artifact.projected_mark_count), 0)::int as "projectedMarkCount",
      state.published_through_date::text as "publishedThroughDate"
    from (select 1) anchor
    left join corpus_state state on state.id = 'uspto'
    left join corpus_generation generation on generation.id = coalesce(
      state.current_generation_id,
      (select id from corpus_generation where state = 'building' order by created_at limit 1)
    )
    left join source_artifact artifact on artifact.generation_id = generation.id
    group by state.current_generation_id, state.complete_through_date, state.corpus_version,
      state.last_successful_merge_at, state.published_through_date, generation.expected_artifact_count
  `;
  const [lane] = await database<AnnualCorpusStatus["lane"][]>`
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
    throw new Error("Annual corpus status is unavailable");
  }
  return { ...status, currentArtifact: currentArtifact ?? null, lane };
}

async function insertProjectionBatch(
  database: Database,
  generationId: string,
  batch: AnnualMarkProjection[]
) {
  const source = (projection: AnnualMarkProjection) => ({
    source_filename: projection.coordinate.filename,
    source_physical_record_index: projection.coordinate.physicalRecordIndex,
    source_product: projection.coordinate.product,
    source_sha256: projection.coordinate.sha256,
  });
  await database`insert into mark ${database(
    batch.map((projection) => ({
      filing_date: projection.filingDate,
      generation_id: generationId,
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
  )}`;
  const classes = batch.flatMap((projection) =>
    projection.classes.map((item, index) => ({
      generation_id: generationId,
      international_code: item.internationalCode,
      ordinal: index + 1,
      serial_number: projection.serialNumber,
      status_code: item.statusCode,
      status_date: item.statusDate,
      ...source(projection),
    }))
  );
  const owners = batch.flatMap((projection) =>
    projection.owners.map((item, index) => ({
      entry_number: item.entryNumber,
      generation_id: generationId,
      ordinal: index + 1,
      party_name: item.partyName,
      party_type: item.partyType,
      serial_number: projection.serialNumber,
      ...source(projection),
    }))
  );
  const goods = batch.flatMap((projection) =>
    projection.goodsServices.map((item, index) => ({
      generation_id: generationId,
      ordinal: index + 1,
      serial_number: projection.serialNumber,
      text: item.text,
      type_code: item.typeCode,
      ...source(projection),
    }))
  );
  const events = batch.flatMap((projection) =>
    projection.statusEvents.map((item) => ({
      code: item.code,
      description: item.description,
      event_date: item.date,
      event_key: item.eventKey,
      event_number: item.number,
      generation_id: generationId,
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
    await database`insert into mark_status_event ${database(events)}`;
  }
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
  const artifacts = annualGenerationV1Artifacts.map((filename) => {
    const artifact = byFilename.get(filename);
    if (
      !artifact ||
      artifact.fromDate !== generationFromDate ||
      artifact.toDate !== generationToDate
    ) {
      throw new SourceContractError(`Annual catalog is missing pinned member ${filename}`);
    }
    return artifact;
  });
  if (artifacts.length !== expectedArtifacts) {
    throw new SourceContractError("Annual generation must contain 91 members");
  }
  return artifacts;
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
