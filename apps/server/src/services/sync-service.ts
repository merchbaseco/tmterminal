import type postgres from "postgres";

import type { SyncService, SyncStatus } from "../api/contracts.ts";
import { type AnnualCorpusStatus, readAnnualCorpusStatus } from "../ingestion/annual-corpus.ts";

const stalenessGraceDays = 3;

function staleSince(completeThroughDate: string | null) {
  if (!completeThroughDate) {
    return null;
  }
  const value = new Date(`${completeThroughDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + stalenessGraceDays + 1);
  return value.toISOString();
}

export function syncStatusFromFacts(facts: AnnualCorpusStatus): SyncStatus {
  let activeState: SyncStatus["activeState"] = "idle";
  if (facts.lane.status === "backoff") {
    activeState = "backoff";
  }
  if (facts.lane.status === "stopped") {
    activeState = "stopped";
  }
  if (facts.currentArtifact?.state === "downloading") {
    activeState = "downloading";
  }
  if (facts.currentArtifact?.state === "projecting") {
    activeState = "parsing";
  }
  if (facts.failedArtifactCount > 0) {
    activeState = "failed";
  }
  const staleAt = staleSince(facts.completeThroughDate);
  const stale = staleAt === null || Date.now() >= Date.parse(staleAt);
  const failedCount = facts.failedArtifactCount + (facts.lane.status === "stopped" ? 1 : 0);
  const degradationTimes: number[] = [];
  if (staleAt && stale) {
    degradationTimes.push(Date.parse(staleAt));
  }
  if (facts.failedArtifactCount > 0 && facts.failedArtifactUpdatedAt) {
    degradationTimes.push(facts.failedArtifactUpdatedAt.getTime());
  }
  if (facts.lane.status === "backoff" || facts.lane.status === "stopped") {
    degradationTimes.push(facts.lane.updatedAt.getTime());
  }
  const degradedSince =
    degradationTimes.length > 0 ? new Date(Math.min(...degradationTimes)).toISOString() : null;
  return {
    activeState,
    completeThroughDate: facts.completeThroughDate,
    corpusVersion: facts.corpusVersion,
    degraded:
      stale ||
      failedCount > 0 ||
      facts.completeThroughDate === null ||
      facts.lane.status === "backoff",
    degradedSince,
    failedCount,
    lastSuccessfulMergeAt: facts.lastSuccessfulMergeAt?.toISOString() ?? null,
    pendingCount: facts.pendingArtifactCount,
    publishedThroughDate: facts.publishedThroughDate,
    quarantineCount: 0,
    reissueSelectionRequiredCount: 0,
    rejectCount: 0,
    stale,
    staleSince: stale ? staleAt : null,
  };
}

export function createSyncService(database: postgres.Sql): SyncService {
  return {
    async status() {
      return syncStatusFromFacts(await readAnnualCorpusStatus(database));
    },
  };
}
