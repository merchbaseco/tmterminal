import { createHash } from "node:crypto";
import type postgres from "postgres";

import {
  ensureArtifactScheduler,
  findDueProduct,
  findInterruptedAttempt,
  findPendingDiscovery,
  finishSourceAttemptFailure,
  readSourceLane,
  reconcileDiscoverySuccess,
  reserveArtifactScheduler,
  retainArtifactVersion,
  startDownloadAttempt,
  startSourceAttempt,
} from "../queries/artifact-repository.ts";
import { ArtifactIntegrityError, type ArtifactStore } from "./artifact-store.ts";
import {
  SourceContractError,
  SourceHttpError,
  SourceTransportError,
  type DiscoveredArtifact,
  type SourceCatalog,
  type SourceResponseState,
} from "./source-catalog.ts";

type KnownFailure = {
  alertKind: "credential" | "permanent" | null;
  errorCode: string;
  outcome: "credential_failure" | "permanent_failure" | "transient_failure";
  responseState: SourceResponseState;
};

function classifyFailure(error: unknown): KnownFailure | null {
  if (error instanceof SourceHttpError) {
    const status = error.responseState.status;
    if (status === 401 || status === 403) {
      return { alertKind: "credential", errorCode: `HTTP_${status}`, outcome: "credential_failure", responseState: error.responseState };
    }
    if (status === 408 || status === 425 || status === 429 || status >= 500) {
      return { alertKind: null, errorCode: `HTTP_${status}`, outcome: "transient_failure", responseState: error.responseState };
    }
    return { alertKind: "permanent", errorCode: `HTTP_${status}`, outcome: "permanent_failure", responseState: error.responseState };
  }
  if (error instanceof SourceTransportError) {
    return { alertKind: null, errorCode: "TRANSPORT", outcome: "transient_failure", responseState: { status: 0 } };
  }
  if (error instanceof ArtifactIntegrityError) {
    return { alertKind: null, errorCode: "INTEGRITY", outcome: "transient_failure", responseState: { status: 0 } };
  }
  if (error instanceof SourceContractError) {
    return { alertKind: "permanent", errorCode: "SOURCE_CONTRACT", outcome: "permanent_failure", responseState: { status: 200 } };
  }
  return null;
}

function headerEligibility(state: SourceResponseState, now: Date) {
  const candidates: number[] = [];
  if (state.retryAfter) {
    const seconds = Number(state.retryAfter);
    const value = Number.isFinite(seconds) ? now.getTime() + seconds * 1_000 : Date.parse(state.retryAfter);
    if (Number.isFinite(value)) candidates.push(value);
  }
  if (state.rateLimitReset) {
    const reset = Number(state.rateLimitReset);
    if (Number.isFinite(reset)) {
      candidates.push(reset >= 1_000_000_000_000 ? reset : reset >= 1_000_000_000 ? reset * 1_000 : now.getTime() + reset * 1_000);
    }
  }
  return candidates.length === 0 ? null : new Date(Math.max(...candidates));
}

function fingerprint(artifact: DiscoveredArtifact) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        artifact.filename,
        artifact.bytes,
        artifact.downloadUrl,
        artifact.fromDate,
        artifact.toDate,
        artifact.releaseDate,
        artifact.lastModifiedAt,
      ]),
    )
    .digest("hex");
}

export function createArtifactScheduler(options: {
  artifactStore: ArtifactStore;
  database: postgres.Sql;
  discoveryIntervalMs: number;
  now?: () => Date;
  products: string[];
  retry?: { baseMs: number; jitter: () => number; maxAttempts?: number; maxMs: number };
  sourceCatalog: SourceCatalog;
}) {
  const now = options.now ?? (() => new Date());
  const retry = options.retry ?? { baseMs: 30_000, jitter: Math.random, maxAttempts: 8, maxMs: 6 * 60 * 60 * 1_000 };
  const maxAttempts = retry.maxAttempts ?? 8;

  async function persistFailure(
    database: postgres.Sql,
    lane: Awaited<ReturnType<typeof readSourceLane>>,
    attemptId: string,
    discoveryId: string | null,
    failure: KnownFailure,
    finishedAt: Date,
  ) {
    const transientFailureCount = lane.transientFailureCount + (failure.outcome === "transient_failure" ? 1 : 0);
    const exhausted = failure.outcome === "transient_failure" && transientFailureCount >= maxAttempts;
    const persistedFailure: KnownFailure = exhausted
      ? {
          alertKind: "permanent",
          errorCode: "RETRY_EXHAUSTED",
          outcome: "permanent_failure",
          responseState: failure.responseState,
        }
      : failure;
    let nextEligibleAt: Date | null = null;
    if (persistedFailure.outcome === "transient_failure") {
      const exponentialMs = Math.min(retry.maxMs, retry.baseMs * 2 ** (transientFailureCount - 1));
      const jitterMs = Math.floor(exponentialMs * 0.2 * retry.jitter());
      const backoffAt = new Date(finishedAt.getTime() + exponentialMs + jitterMs);
      const providerAt = headerEligibility(failure.responseState, finishedAt);
      nextEligibleAt = providerAt && providerAt > backoffAt ? providerAt : backoffAt;
    }
    await finishSourceAttemptFailure(database, {
      ...persistedFailure,
      discoveryId,
      attemptId,
      finishedAt,
      nextEligibleAt,
      transientFailureCount,
    });
    return persistedFailure.outcome === "transient_failure"
      ? { nextEligibleAt: nextEligibleAt!, status: "backoff" as const }
      : { reason: persistedFailure.errorCode, status: "stopped" as const };
  }

  return {
    async runOnce() {
      await ensureArtifactScheduler(options.database, options.products);
      const reservation = await reserveArtifactScheduler(options.database);
      if (!reservation) return { status: "busy" as const };

      try {
        const lane = await readSourceLane(reservation.database);
        const startedAt = now();
        if (lane.status === "stopped") return { status: "stopped" as const };
        const interrupted = await findInterruptedAttempt(reservation.database);
        if (interrupted) {
          return persistFailure(
            reservation.database,
            lane,
            interrupted.attemptId,
            interrupted.discoveryId,
            {
              alertKind: null,
              errorCode: "INTERRUPTED",
              outcome: "transient_failure",
              responseState: { status: 0 },
            },
            startedAt,
          );
        }
        if (lane.nextEligibleAt && lane.nextEligibleAt > startedAt) {
          return { status: "backoff" as const, nextEligibleAt: lane.nextEligibleAt };
        }

        let attemptId: string | null = null;
        let attemptedDiscoveryId: string | null = null;
        try {
          const product = await findDueProduct(reservation.database, startedAt);
          if (!product) {
            const discovery = await findPendingDiscovery(reservation.database);
            if (!discovery) return { status: "idle" as const };

            attemptedDiscoveryId = discovery.discoveryId;
            attemptId = await startDownloadAttempt(reservation.database, discovery.discoveryId, startedAt);
            const download = await options.sourceCatalog.download(discovery.downloadUrl);
            if (download.expectedBytes !== null && download.expectedBytes !== discovery.expectedBytes) {
              throw new ArtifactIntegrityError(
                `Artifact catalog expected ${discovery.expectedBytes} bytes, response declared ${download.expectedBytes}`,
              );
            }
            const stored = await options.artifactStore.put(download.body, discovery.expectedBytes);
            const versionCreated = await retainArtifactVersion(
              reservation.database,
              discovery.artifactId,
              discovery.discoveryId,
              attemptId,
              stored,
              download.responseState,
              now(),
            );
            return {
              action: "download" as const,
              filename: discovery.filename,
              status: "ran" as const,
              versionCreated,
            };
          }

          attemptId = await startSourceAttempt(reservation.database, product.id, startedAt);
          const discovery = await options.sourceCatalog.discover(product.id);
          const observedAt = now();
          const changed = await reconcileDiscoverySuccess(
            reservation.database,
            discovery,
            discovery.artifacts.map((artifact) => ({ ...artifact, fingerprint: fingerprint(artifact) })),
            attemptId,
            observedAt,
            new Date(observedAt.getTime() + options.discoveryIntervalMs),
          );
          return { action: "discover" as const, changed, productIdentifier: product.id, status: "ran" as const };
        } catch (error) {
          const failure = classifyFailure(error);
          if (!attemptId || !failure) throw error;
          return persistFailure(reservation.database, lane, attemptId, attemptedDiscoveryId, failure, now());
        }
      } finally {
        await reservation.release();
      }
    },
  };
}
