import type postgres from "postgres";

import type { SyncService, SyncStatus } from "../api/contracts.ts";
import {
  readTrademarkIngestionStatus,
  type TrademarkIngestionStatus,
  workerHeartbeatStaleAfterMs,
} from "../ingestion/trademark-ingestion.ts";

export function syncStatusFromFacts(facts: TrademarkIngestionStatus, now = new Date()): SyncStatus {
  const workerSignalAt = facts.worker.lastHeartbeatAt ?? facts.worker.updatedAt;
  const workerFailed =
    facts.worker.currentError !== null ||
    workerSignalAt === null ||
    now.getTime() - workerSignalAt.getTime() > workerHeartbeatStaleAfterMs;
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
