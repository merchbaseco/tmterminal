import type postgres from "postgres";

import type { OperatorDatasetStatus, OperatorSyncService } from "../api/contracts.ts";
import {
  annualGenerationArtifactCount,
  isPublicationPolicyArtifact,
} from "../ingestion/publication-policy.ts";
import { readEligibleParseRuns } from "../queries/corpus-publication-repository.ts";
import {
  readOperatorArtifacts,
  readOperatorArtifactVersions,
  readOperatorDatasetFacts,
  readOperatorPublications,
  readOperatorRejections,
} from "../queries/operator-sync-repository.ts";
import { readSyncFacts } from "../queries/sync-repository.ts";
import { syncStatusFromFacts } from "./sync-service.ts";

function safeDiagnosticReason(message: string | null) {
  if (!message) {
    return null;
  }
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

type DatasetFacts = Awaited<ReturnType<typeof readOperatorDatasetFacts>>[number];
type DatasetStage = Pick<OperatorDatasetStatus, "currentStage" | "reason"> & {
  stageSince: Date | null;
};

function inactiveDatasetStage(facts: DatasetFacts, rejectedSince: Date | null): DatasetStage {
  if (facts.reconcileFailedSince) {
    return {
      currentStage: "failed",
      reason: safeDiagnosticReason(facts.reconcileFailureMessage) ?? "Reconciliation failed",
      stageSince: facts.reconcileFailedSince,
    };
  }
  if (facts.reissueRequiredCount > 0) {
    return {
      currentStage: "operator-action-required",
      reason: "Retained artifact version selection required",
      stageSince: facts.reissueRequiredSince,
    };
  }
  if (facts.laneStatus === "stopped") {
    return { currentStage: "stopped", reason: facts.stopReason, stageSince: facts.laneUpdatedAt };
  }
  if (facts.laneStatus === "backoff") {
    return {
      currentStage: "backoff",
      reason: facts.providerBackoffUntil
        ? `Provider backoff until ${facts.providerBackoffUntil.toISOString()}`
        : "Provider backoff",
      stageSince: facts.laneUpdatedAt,
    };
  }
  if (facts.quarantineCount > 0) {
    return {
      currentStage: "quarantined",
      reason: "Current artifact version quarantined",
      stageSince: facts.quarantineSince,
    };
  }
  if (facts.rejectCount + facts.publicationRejectCount > 0) {
    return {
      currentStage: "rejected",
      reason: "Current publication or parser rejection",
      stageSince: rejectedSince,
    };
  }
  return {
    currentStage: facts.backlogCount > 0 ? "pending" : "idle",
    reason: null,
    stageSince: null,
  };
}

function datasetStage(facts: DatasetFacts, rejectedSince: Date | null): DatasetStage {
  if (facts.activeAttemptKind) {
    return {
      currentStage: facts.activeAttemptKind === "discovery" ? "discovering" : "downloading",
      reason: null,
      stageSince: facts.activeAttemptStartedAt,
    };
  }
  if (facts.activeParse && facts.activeReconcileSince) {
    return { currentStage: "parsing", reason: null, stageSince: facts.activeReconcileSince };
  }
  if (facts.activePublication && facts.activeReconcileSince) {
    return { currentStage: "publishing", reason: null, stageSince: facts.activeReconcileSince };
  }
  return inactiveDatasetStage(facts, rejectedSince);
}

function datasetStatus(
  facts: DatasetFacts,
  publicationParsedArtifactCount: number
): OperatorDatasetStatus {
  const rejectCount = facts.rejectCount + facts.publicationRejectCount;
  const rejectedSince =
    [facts.rejectedSince, facts.publicationRejectedSince]
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const { currentStage, reason, stageSince } = datasetStage(facts, rejectedSince);
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
    providerStopReason:
      facts.laneStatus === "stopped" ? safeDiagnosticReason(facts.stopReason) : null,
    publicationParsedArtifactCount:
      facts.product === "TRTYRAP" ? publicationParsedArtifactCount : 0,
    publicationPolicy: facts.product === "TRTYRAP" ? "annual-baseline" : "retained-only",
    publicationTargetArtifactCount:
      facts.product === "TRTYRAP" ? annualGenerationArtifactCount() : 0,
    quarantineCount: facts.quarantineCount,
    reason,
    rejectCount,
    stageSince: stageSince?.toISOString() ?? null,
  };
}

export function createOperatorSyncService(database: postgres.Sql): OperatorSyncService {
  return {
    artifacts(input) {
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
    artifactVersions(input) {
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
    publications(input) {
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
    rejects(input) {
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
    status() {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const [syncFacts, datasets, eligibleParseRuns] = await Promise.all([
          readSyncFacts(transaction),
          readOperatorDatasetFacts(transaction),
          readEligibleParseRuns(transaction),
        ]);
        const publicationParsedArtifactCount = new Set(
          eligibleParseRuns
            .filter(isPublicationPolicyArtifact)
            .map((artifact) => artifact.artifactId)
        ).size;
        return {
          datasets: datasets.map((dataset) =>
            datasetStatus(dataset, publicationParsedArtifactCount)
          ),
          summary: syncStatusFromFacts(syncFacts),
        };
      });
    },
  };
}
