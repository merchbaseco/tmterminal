import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type postgres from "postgres";

import { lockIngestion } from "../queries/ingestion-lock.ts";
import type { ArtifactStore } from "./artifact-store.ts";

const maximumZipRequests = 20;

type Database = postgres.Sql | postgres.TransactionSql;

interface SourceArtifactRow {
  bytes: string | null;
  downloadError: string | null;
  downloadRequestCount: number;
  downloadResponseState: unknown;
  downloadState: "complete" | "downloading" | "failed" | "pending" | "unavailable";
  expectedBytes: string;
  filename: string;
  id: string;
  objectKey: string | null;
  physicalRecordCount: number;
  product: string;
  projectedMarkCount: number;
  projectionError: string | null;
  projectionState: "complete" | "failed" | "pending" | "projecting";
  projectionVersion: string | null;
  sha256: string | null;
  sourceFromDate: string;
  sourceToDate: string;
  updatedAt: Date;
}

interface SourceLaneRow {
  currentError: string | null;
  nextEligibleAt: Date | null;
  status: "backoff" | "ready" | "stopped";
  updatedAt: Date;
}

export interface SourceRepairFacts {
  bytes: string | null;
  downloadError: string | null;
  downloadRequestCount: number;
  downloadResponseState: unknown;
  downloadState: SourceArtifactRow["downloadState"];
  expectedBytes: string;
  filename: string;
  hasRetainedZip: boolean;
  id: string;
  physicalRecordCount: number;
  product: string;
  projectedMarkCount: number;
  projectionError: string | null;
  projectionState: SourceArtifactRow["projectionState"];
  projectionVersion: string | null;
  sha256: string | null;
  sourceFromDate: string;
  sourceLaneError: string | null;
  sourceLaneNextEligibleAt: Date | null;
  sourceLaneStatus: SourceLaneRow["status"];
  sourceLaneUpdatedAt: Date;
  sourceToDate: string;
  updatedAt: Date;
}

export async function inspectSourceArtifact(
  artifactStore: ArtifactStore,
  database: Database,
  identity: { filename: string; product: string }
) {
  const artifact = await readSourceArtifact(database, identity);
  if (!artifact) {
    throw new Error(`Source artifact not found: ${identity.product}/${identity.filename}`);
  }
  const sourceLane = await readSourceLane(database);
  return facts(artifact, sourceLane, await hasVerifiedRetainedZip(artifactStore, artifact));
}

export function repairSourceArtifact(
  artifactStore: ArtifactStore,
  database: postgres.Sql,
  input: {
    action: "reacquire" | "replay";
    filename: string;
    product: string;
  }
) {
  return database.begin(async (transaction) => {
    await lockIngestion(transaction);
    const artifact = await readSourceArtifact(transaction, input, true);
    if (!artifact) {
      throw new Error(`Source artifact not found: ${input.product}/${input.filename}`);
    }
    const sourceLane = await readSourceLane(transaction);
    let hasRetainedZip = false;

    if (input.action === "reacquire") {
      authorizeSourceLane(sourceLane);
      authorizeReacquisition(artifact);
      await transaction`
        update source_artifact set download_state = 'pending', download_error = null,
          download_response_state = null, projection_state = 'pending',
          projection_error = null, updated_at = now()
        where id = ${artifact.id}
      `;
    } else {
      await authorizeReplay(artifactStore, artifact);
      hasRetainedZip = true;
      await transaction`
        update source_artifact set projection_state = 'pending', projection_error = null,
          updated_at = now()
        where id = ${artifact.id}
      `;
    }

    const repaired = await readSourceArtifact(transaction, input);
    if (!repaired) {
      throw new Error(`Source artifact disappeared during repair: ${artifact.id}`);
    }
    return facts(repaired, sourceLane, hasRetainedZip);
  });
}

export function importSourceArtifact(
  artifactStore: ArtifactStore,
  database: postgres.Sql,
  input: {
    body: ReadableStream<Uint8Array>;
    filename: string;
    product: string;
  }
) {
  return reserveImport(database, input).then(async ({ artifactId, expectedBytes }) => {
    let stored: Awaited<ReturnType<ArtifactStore["put"]>>;
    try {
      stored = await artifactStore.put(input.body, expectedBytes);
    } catch (error) {
      await failImport(database, artifactId, error);
      throw error;
    }
    return database.begin(async (transaction) => {
      await lockIngestion(transaction);
      const completed = await transaction<Array<{ id: string }>>`
        update source_artifact set download_state = 'complete', download_error = null,
          download_response_state = null, projection_state = 'pending', projection_error = null,
          sha256 = ${stored.sha256}, bytes = ${stored.bytes}, object_key = ${stored.objectKey},
          downloaded_at = now(), updated_at = now()
        where id = ${artifactId} and download_state = 'downloading'
        returning id
      `;
      if (completed.length !== 1) {
        throw new Error(`Source artifact import reservation was lost: ${artifactId}`);
      }
      const imported = await readSourceArtifact(transaction, input);
      if (!imported) {
        throw new Error(`Source artifact disappeared during import: ${artifactId}`);
      }
      return facts(imported, await readSourceLane(transaction), true);
    });
  });
}

function reserveImport(database: postgres.Sql, input: { filename: string; product: string }) {
  return database.begin(async (transaction) => {
    await lockIngestion(transaction);
    const artifact = await readSourceArtifact(transaction, input, true);
    if (!artifact) {
      throw new Error(`Source artifact not found: ${input.product}/${input.filename}`);
    }
    authorizeImport(artifact);
    const expectedBytes = Number(artifact.expectedBytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
      throw new Error(`Source artifact ${artifact.id} has an invalid expected byte count`);
    }
    await transaction`
      update source_artifact set download_state = 'downloading', download_error = null,
        download_request_count = download_request_count + 1, download_response_state = null,
        projection_state = 'pending', projection_error = null, updated_at = now()
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
      update source_artifact set download_state = 'failed', download_error = ${message},
        updated_at = now() where id = ${artifactId} and download_state = 'downloading'
    `;
  });
}

function authorizeReacquisition(artifact: SourceArtifactRow) {
  if (artifact.objectKey !== null) {
    throw new Error("Reacquisition is forbidden while a retained ZIP exists; use replay");
  }
  if (artifact.sha256 !== null) {
    throw new Error("Reacquisition of previously retained bytes requires content-revision support");
  }
  const eligibleState =
    artifact.downloadState === "failed" || artifact.downloadState === "unavailable";
  if (!eligibleState) {
    throw new Error(`Reacquisition requires a blocked download, not ${artifact.downloadState}`);
  }
  if (artifact.downloadRequestCount >= maximumZipRequests) {
    throw new Error(
      `Reacquisition would exceed the conservative ${maximumZipRequests}-request ZIP limit`
    );
  }
}

function authorizeImport(artifact: SourceArtifactRow) {
  if (artifact.objectKey !== null || artifact.sha256 !== null) {
    throw new Error("Import is forbidden while retained or previously retained bytes exist");
  }
  if (artifact.downloadState !== "failed" && artifact.downloadState !== "unavailable") {
    throw new Error(`Import requires a blocked download, not ${artifact.downloadState}`);
  }
}

async function authorizeReplay(artifactStore: ArtifactStore, artifact: SourceArtifactRow) {
  if (artifact.objectKey === null || artifact.downloadState !== "complete") {
    throw new Error("Replay requires a retained ZIP");
  }
  if (artifact.projectionState !== "failed") {
    throw new Error(`Replay requires failed application, not ${artifact.projectionState}`);
  }
  await hasVerifiedRetainedZip(artifactStore, artifact);
}

async function readSourceArtifact(
  database: Database,
  identity: { filename: string; product: string },
  forUpdate = false
) {
  const rows = await database<SourceArtifactRow[]>`
    select bytes::text, download_error as "downloadError",
      download_request_count as "downloadRequestCount",
      download_response_state as "downloadResponseState", download_state as "downloadState",
      expected_bytes::text as "expectedBytes", filename, id, object_key as "objectKey",
      physical_record_count as "physicalRecordCount",
      product, projected_mark_count as "projectedMarkCount",
      projection_error as "projectionError", projection_state as "projectionState",
      projection_version as "projectionVersion", sha256,
      source_from_date::text as "sourceFromDate", source_to_date::text as "sourceToDate",
      updated_at as "updatedAt"
    from source_artifact
    where product = ${identity.product} and filename = ${identity.filename}
    ${forUpdate ? database`for update` : database``}
  `;
  return rows[0] ?? null;
}

async function readSourceLane(database: Database) {
  const [sourceLane] = await database<SourceLaneRow[]>`
    select current_error as "currentError", next_eligible_at as "nextEligibleAt", status,
      updated_at as "updatedAt"
    from source_lane where id = 'uspto-odp'
  `;
  if (!sourceLane) {
    throw new Error("USPTO source lane is unavailable");
  }
  return sourceLane;
}

function authorizeSourceLane(sourceLane: SourceLaneRow) {
  if (sourceLane.status === "stopped") {
    throw new Error("Source repair requires an available USPTO lane, not stopped");
  }
  if (
    sourceLane.status === "backoff" &&
    sourceLane.nextEligibleAt &&
    sourceLane.nextEligibleAt > new Date()
  ) {
    throw new Error("Source repair requires the USPTO lane backoff to expire");
  }
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

function facts(
  artifact: SourceArtifactRow,
  sourceLane: SourceLaneRow,
  hasRetainedZip: boolean
): SourceRepairFacts {
  const { objectKey, ...visible } = artifact;
  return {
    ...visible,
    hasRetainedZip,
    sourceLaneError: sourceLane.currentError,
    sourceLaneNextEligibleAt: sourceLane.nextEligibleAt,
    sourceLaneStatus: sourceLane.status,
    sourceLaneUpdatedAt: sourceLane.updatedAt,
  };
}
