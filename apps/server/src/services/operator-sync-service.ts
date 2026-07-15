import type postgres from "postgres";

import type { OperatorDatasetStatus, OperatorSyncService } from "../api/contracts.ts";
import {
  readOperatorDatasetFacts,
  readOperatorArtifacts,
  readOperatorArtifactVersions,
  readOperatorPublications,
  readOperatorRejections,
} from "../queries/operator-sync-repository.ts";
import { readSyncFacts } from "../queries/sync-repository.ts";
import { syncStatusFromFacts } from "./sync-service.ts";

function safeDiagnosticReason(message: string | null) {
  if (!message) return null;
  return message.replace(/https?:\/\/\S+/g, "[url]").replace(/\s+/g, " ").slice(0, 240);
}

function datasetStatus(
  facts: Awaited<ReturnType<typeof readOperatorDatasetFacts>>[number],
): OperatorDatasetStatus {
  const rejectCount = facts.rejectCount + facts.publicationRejectCount;
  const rejectedSince = [facts.rejectedSince, facts.publicationRejectedSince]
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  let currentStage: OperatorDatasetStatus["currentStage"] = facts.backlogCount > 0 ? "pending" : "idle";
  let stageSince: Date | null = null;
  let reason: string | null = null;
  if (rejectCount > 0) {
    currentStage = "rejected";
    stageSince = rejectedSince;
    reason = "Current publication or parser rejection";
  }
  if (facts.quarantineCount > 0) {
    currentStage = "quarantined";
    stageSince = facts.quarantineSince;
    reason = "Current artifact version quarantined";
  }
  if (facts.laneStatus === "backoff") {
    currentStage = "backoff";
    stageSince = facts.laneUpdatedAt;
    reason = facts.providerBackoffUntil ? `Provider backoff until ${facts.providerBackoffUntil.toISOString()}` : "Provider backoff";
  }
  if (facts.laneStatus === "stopped") {
    currentStage = "stopped";
    stageSince = facts.laneUpdatedAt;
    reason = facts.stopReason;
  }
  if (facts.reissueRequiredCount > 0) {
    currentStage = "operator-action-required";
    stageSince = facts.reissueRequiredSince;
    reason = "Retained artifact version selection required";
  }
  if (facts.reconcileFailedSince) {
    currentStage = "failed";
    stageSince = facts.reconcileFailedSince;
    reason = safeDiagnosticReason(facts.reconcileFailureMessage) ?? "Reconciliation failed";
  }
  if (facts.activeAttemptKind) {
    currentStage = facts.activeAttemptKind === "discovery" ? "discovering" : "downloading";
    stageSince = facts.activeAttemptStartedAt;
    reason = null;
  } else if (facts.activeParse && facts.activeReconcileSince) {
    currentStage = "parsing";
    stageSince = facts.activeReconcileSince;
    reason = null;
  } else if (facts.activePublication && facts.activeReconcileSince) {
    currentStage = "publishing";
    stageSince = facts.activeReconcileSince;
    reason = null;
  }
  return {
    backlogCount: facts.backlogCount,
    completeThroughDate: facts.completeThroughDate,
    coverageFromDate: facts.coverageFromDate,
    coverageThroughDate: facts.coverageThroughDate,
    currentStage,
    failedCount: facts.failedCount,
    latestPublicationAt: facts.latestPublicationAt?.toISOString() ?? null,
    latestSuccessfulActivityAt: facts.latestSuccessfulActivityAt?.toISOString() ?? null,
    product: facts.product,
    providerBackoffUntil: facts.providerBackoffUntil?.toISOString() ?? null,
    providerStopReason: facts.laneStatus === "stopped" ? safeDiagnosticReason(facts.stopReason) : null,
    quarantineCount: facts.quarantineCount,
    reason,
    rejectCount,
    stageSince: stageSince?.toISOString() ?? null,
  };
}

export function createOperatorSyncService(database: postgres.Sql): OperatorSyncService {
  return {
    async artifacts(input) {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const page = await readOperatorArtifacts(transaction, input);
        return {
          items: page.items.map((item) => ({
            ...item,
            bytes: item.bytes === null ? null : Number(item.bytes),
            lastErrorAt: item.lastErrorAt?.toISOString() ?? null,
            observedAt: item.observedAt.toISOString(),
            quarantineReason: safeDiagnosticReason(item.quarantineReason),
            stageSince: item.stageSince.toISOString(),
          })),
          limit: input.limit,
          offset: input.offset,
          total: page.total,
        };
      });
    },
    async artifactVersions(input) {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const page = await readOperatorArtifactVersions(transaction, input);
        return {
          items: page.items.map((item) => ({
            ...item,
            bytes: Number(item.bytes),
            createdAt: item.createdAt.toISOString(),
            observedAt: item.observedAt?.toISOString() ?? null,
            quarantineReason: safeDiagnosticReason(item.quarantineReason),
          })),
          limit: input.limit,
          offset: input.offset,
          total: page.total,
        };
      });
    },
    async publications(input) {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const page = await readOperatorPublications(transaction, input);
        return {
          items: page.items.map((item) => ({
            ...item,
            corpusVersion: item.corpusVersion === null ? null : Number(item.corpusVersion),
            createdAt: item.createdAt.toISOString(),
            publishedAt: item.publishedAt?.toISOString() ?? null,
            rejectedAt: item.rejectedAt?.toISOString() ?? null,
          })),
          limit: input.limit,
          offset: input.offset,
          total: page.total,
        };
      });
    },
    async rejects(input) {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const page = await readOperatorRejections(transaction, input);
        return {
          items: page.items.map((item) => ({
            ...item,
            bytes: item.bytes === null ? null : Number(item.bytes),
            createdAt: item.createdAt.toISOString(),
          })),
          limit: input.limit,
          offset: input.offset,
          total: page.total,
        };
      });
    },
    async status() {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const [syncFacts, datasets] = await Promise.all([
          readSyncFacts(transaction),
          readOperatorDatasetFacts(transaction),
        ]);
        return {
          datasets: datasets.map((dataset) => datasetStatus(dataset)),
          summary: syncStatusFromFacts(syncFacts),
        };
      });
    },
  };
}
