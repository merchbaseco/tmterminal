import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type postgres from "postgres";

import { lockIngestion } from "../queries/ingestion-lock.ts";
import type { ArtifactStore } from "./artifact-store.ts";

const maximumZipRequests = 20;
type Database = postgres.Sql | postgres.TransactionSql;

interface SourceArtifactRow {
  applicationState: "applying" | "complete" | "needs_attention" | "pending";
  appliedRecordCount: number;
  bytes: string | null;
  contentRevision: number;
  currentError: string | null;
  downloadRequestCount: number;
  downloadResponseState: unknown;
  downloadState: "blocked" | "downloaded" | "downloading" | "pending";
  expectedBytes: string;
  filename: string;
  id: string;
  objectKey: string | null;
  parserVersion: string | null;
  physicalRecordCount: number;
  processingDisposition: "covered" | "deferred" | "required";
  product: string;
  projectedMarkCount: number;
  sha256: string | null;
  sourceFromDate: string;
  sourceToDate: string;
  unresolvedRecordCount: number;
  updatedAt: Date;
}

export type SourceRepairFacts = Omit<SourceArtifactRow, "objectKey"> & {
  hasRetainedZip: boolean;
};

export type SourceInspectionFacts = SourceRepairFacts & {
  worker: {
    activity: "applying" | "discovering" | "downloading" | "idle";
    currentError: string | null;
    currentFilename: string | null;
    lastHeartbeatAt: Date | null;
  } | null;
};

export async function inspectSourceArtifact(
  artifactStore: ArtifactStore,
  database: Database,
  identity: { filename: string; product: string }
) {
  const artifact = await requireSourceArtifact(database, identity);
  const worker = await readWorkerStatus(database);
  return {
    ...facts(artifact, await hasVerifiedRetainedZip(artifactStore, artifact)),
    worker,
  } satisfies SourceInspectionFacts;
}

export function repairSourceArtifact(
  artifactStore: ArtifactStore,
  database: postgres.Sql,
  input: { action: "promote" | "reacquire" | "replay"; filename: string; product: string }
) {
  return database.begin(async (transaction) => {
    await lockIngestion(transaction);
    const artifact = await requireSourceArtifact(transaction, input, true);
    let hasRetainedZip = false;
    if (input.action === "reacquire") {
      authorizeReacquisition(artifact);
      await transaction`
        update source_artifact set download_state = 'pending', application_state = 'pending',
          current_error = null, download_response_state = null, updated_at = now()
        where id = ${artifact.id}
      `;
    } else if (input.action === "replay") {
      await authorizeReplay(artifactStore, artifact);
      hasRetainedZip = true;
      await transaction`
        update source_artifact set application_state = 'pending', current_error = null,
          updated_at = now() where id = ${artifact.id}
      `;
    } else {
      authorizePromotion(artifact);
      await transaction`
        update source_artifact set processing_disposition = 'required',
          selected_broad_from_date = null, selected_broad_to_date = null, updated_at = now()
        where id = ${artifact.id}
      `;
    }
    return facts(await requireSourceArtifact(transaction, input), hasRetainedZip);
  });
}

export function importSourceArtifact(
  artifactStore: ArtifactStore,
  database: postgres.Sql,
  input: { body: ReadableStream<Uint8Array>; filename: string; product: string }
) {
  return reserveImport(database, input).then(async ({ artifactId, expectedBytes }) => {
    let stored: Awaited<ReturnType<ArtifactStore["put"]>>;
    try {
      stored = await artifactStore.put(input.body, expectedBytes, artifactId);
    } catch (error) {
      await failImport(database, artifactId, error);
      throw error;
    }
    return database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const completed = await transaction<Array<{ id: string }>>`
        update source_artifact set download_state = 'downloaded', application_state = 'pending',
          current_error = null, download_response_state = null,
          sha256 = ${stored.sha256}, bytes = ${stored.bytes}, object_key = ${stored.objectKey},
          downloaded_at = now(), updated_at = now()
        where id = ${artifactId} and download_state = 'downloading'
        returning id
      `;
      if (completed.length !== 1) {
        throw new Error(`Source artifact import reservation was lost: ${artifactId}`);
      }
      return facts(await requireSourceArtifact(transaction, input), true);
    });
  });
}

function reserveImport(database: postgres.Sql, input: { filename: string; product: string }) {
  return database.begin(async (transaction) => {
    await lockIngestion(transaction);
    const artifact = await requireSourceArtifact(transaction, input, true);
    authorizeImport(artifact);
    const expectedBytes = Number(artifact.expectedBytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new Error(`Source artifact ${artifact.id} has an invalid expected byte count`);
    }
    await transaction`
      update source_artifact set download_state = 'downloading', application_state = 'pending',
        current_error = null, download_request_count = download_request_count + 1,
        download_response_state = null, updated_at = now()
      where id = ${artifact.id}
    `;
    return { artifactId: artifact.id, expectedBytes };
  });
}

function failImport(database: postgres.Sql, artifactId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Manual import failed";
  return database.begin(async (transaction) => {
    await lockIngestion(transaction);
    await transaction`
      update source_artifact set download_state = 'blocked', current_error = ${message},
        updated_at = now() where id = ${artifactId} and download_state = 'downloading'
    `;
  });
}

function authorizeReacquisition(artifact: SourceArtifactRow) {
  if (artifact.processingDisposition !== "required") {
    throw new Error(
      `Reacquisition requires a required source file, not ${artifact.processingDisposition}`
    );
  }
  if (artifact.objectKey !== null) {
    throw new Error("Reacquisition is forbidden while a retained ZIP exists; use replay");
  }
  if (artifact.sha256 !== null) {
    throw new Error("Reacquisition of prior bytes requires an approved content revision");
  }
  if (artifact.downloadState !== "blocked") {
    throw new Error(`Reacquisition requires a blocked download, not ${artifact.downloadState}`);
  }
  if (artifact.downloadRequestCount >= maximumZipRequests) {
    throw new Error(
      `Reacquisition would exceed the conservative ${maximumZipRequests}-request ZIP limit`
    );
  }
  const retryNotBefore = responseRetryNotBefore(artifact.downloadResponseState);
  if (responseStatus(artifact.downloadResponseState) === 429 && !retryNotBefore) {
    throw new Error("Reacquisition requires a known USPTO retry time");
  }
  if (retryNotBefore && retryNotBefore > new Date()) {
    throw new Error(`Reacquisition is blocked until ${retryNotBefore.toISOString()}`);
  }
}

function responseStatus(value: unknown) {
  if (!(value && typeof value === "object" && "status" in value)) {
    return null;
  }
  const { status } = value as { status?: unknown };
  return typeof status === "number" ? status : null;
}

function responseRetryNotBefore(value: unknown) {
  if (!(value && typeof value === "object" && "retryNotBefore" in value)) {
    return null;
  }
  const { retryNotBefore } = value as { retryNotBefore?: unknown };
  if (typeof retryNotBefore !== "string") {
    return null;
  }
  const milliseconds = Date.parse(retryNotBefore);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function authorizeImport(artifact: SourceArtifactRow) {
  if (artifact.processingDisposition !== "required") {
    throw new Error(
      `Import requires a required source file, not ${artifact.processingDisposition}`
    );
  }
  if (artifact.objectKey !== null || artifact.sha256 !== null) {
    throw new Error("Import is forbidden while retained or previously retained bytes exist");
  }
  if (artifact.downloadState !== "blocked") {
    throw new Error(`Import requires a blocked download, not ${artifact.downloadState}`);
  }
}

function authorizePromotion(artifact: SourceArtifactRow) {
  if (artifact.processingDisposition !== "deferred") {
    throw new Error(
      `Promotion requires a deferred source file, not ${artifact.processingDisposition}`
    );
  }
  if (
    artifact.applicationState !== "pending" ||
    (artifact.downloadState !== "pending" && artifact.downloadState !== "blocked")
  ) {
    throw new Error("Promotion requires an unapplied source file");
  }
}

async function authorizeReplay(artifactStore: ArtifactStore, artifact: SourceArtifactRow) {
  if (artifact.objectKey === null || artifact.downloadState !== "downloaded") {
    throw new Error("Replay requires a retained ZIP");
  }
  if (artifact.applicationState !== "needs_attention") {
    throw new Error(`Replay requires an application issue, not ${artifact.applicationState}`);
  }
  await hasVerifiedRetainedZip(artifactStore, artifact);
}

async function requireSourceArtifact(
  database: Database,
  identity: { filename: string; product: string },
  forUpdate = false
) {
  const [artifact] = await database<SourceArtifactRow[]>`
    select application_state as "applicationState", applied_record_count as "appliedRecordCount",
      bytes::text, content_revision as "contentRevision", current_error as "currentError",
      download_request_count as "downloadRequestCount",
      download_response_state as "downloadResponseState", download_state as "downloadState",
      expected_bytes::text as "expectedBytes", filename, id, object_key as "objectKey",
      parser_version as "parserVersion", physical_record_count as "physicalRecordCount",
      processing_disposition as "processingDisposition", product,
      projected_mark_count as "projectedMarkCount", sha256,
      source_from_date::text as "sourceFromDate", source_to_date::text as "sourceToDate",
      unresolved_record_count as "unresolvedRecordCount", updated_at as "updatedAt"
    from source_artifact where product = ${identity.product} and filename = ${identity.filename}
    ${forUpdate ? database`for update` : database``}
  `;
  if (!artifact) {
    throw new Error(`Source artifact not found: ${identity.product}/${identity.filename}`);
  }
  return artifact;
}

async function hasVerifiedRetainedZip(artifactStore: ArtifactStore, artifact: SourceArtifactRow) {
  if (artifact.objectKey === null) {
    return false;
  }
  if (!(artifact.bytes && artifact.sha256)) {
    throw new Error(`Source artifact ${artifact.id} has incomplete retained ZIP metadata`);
  }
  const path = await artifactStore.openFile(artifact.objectKey);
  const details = await stat(path);
  if (details.size !== Number(artifact.bytes)) {
    throw new Error(`Source artifact ${artifact.id} retained ZIP size does not match`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  if (hash.digest("hex") !== artifact.sha256) {
    throw new Error(`Source artifact ${artifact.id} retained ZIP SHA-256 does not match`);
  }
  return true;
}

function facts(artifact: SourceArtifactRow, hasRetainedZip: boolean): SourceRepairFacts {
  const { objectKey: _objectKey, ...visible } = artifact;
  return { ...visible, hasRetainedZip };
}

async function readWorkerStatus(database: Database) {
  const [worker] = await database<NonNullable<SourceInspectionFacts["worker"]>[]>`
    select activity, current_error as "currentError", current_filename as "currentFilename",
      last_heartbeat_at as "lastHeartbeatAt"
    from worker_status where id = 'uspto'
  `;
  return worker ?? null;
}
