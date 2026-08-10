import type postgres from "postgres";

import type { SyncService, SyncStatus } from "../api/contracts.ts";
import {
  readTrademarkIngestionStatus,
  type TrademarkIngestionStatus,
} from "../ingestion/trademark-ingestion.ts";

const heartbeatStaleAfterMs = 5 * 60 * 1000;

export function syncStatusFromFacts(facts: TrademarkIngestionStatus, now = new Date()): SyncStatus {
  const workerSignalAt = facts.worker.lastHeartbeatAt ?? facts.worker.updatedAt;
  const workerFailed =
    facts.worker.currentError !== null ||
    workerSignalAt === null ||
    now.getTime() - workerSignalAt.getTime() > heartbeatStaleAfterMs;
  return {
    activeState: workerFailed ? "failed" : facts.worker.activity,
    dataVersion: String(facts.dataVersion),
    failedCount: facts.attentionCount + (workerFailed ? 1 : 0),
    lastSuccessfulUpdateAt: facts.lastSuccessfulUpdateAt?.toISOString() ?? null,
    latestProcessedDate: facts.latestProcessedDate,
    pendingCount: facts.pendingArtifactCount,
  };
}

export function createSyncService(database: postgres.Sql): SyncService {
  return {
    async status() {
      return syncStatusFromFacts(await readTrademarkIngestionStatus(database));
    },
  };
}
