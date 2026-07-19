import type postgres from "postgres";

import type { OperatorSyncService } from "../api/contracts.ts";
import { readTrademarkIngestionStatus } from "../ingestion/trademark-ingestion.ts";
import {
  readOperatorArtifacts,
  readOperatorSourceSummary,
} from "../queries/operator-sync-repository.ts";
import { syncStatusFromFacts } from "./sync-service.ts";

const safeError = (value: string | null) =>
  value?.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500) ?? null;

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
            downloadError: safeError(item.downloadError),
            downloadedAt: item.downloadedAt?.toISOString() ?? null,
            projectionCompletedAt: item.projectionCompletedAt?.toISOString() ?? null,
            projectionError: safeError(item.projectionError),
            updatedAt: item.updatedAt.toISOString(),
          })),
          limit: input.limit,
          offset: input.offset,
          total: page.total,
        };
      });
    },
    async status() {
      const [facts, source] = await Promise.all([
        readTrademarkIngestionStatus(database),
        readOperatorSourceSummary(database),
      ]);
      return {
        annualBaseline: {
          completeArtifactCount: facts.annualCompleteArtifactCount,
          expectedArtifactCount: facts.expectedArtifactCount,
          failedArtifactCount: facts.failedArtifactCount,
          projectedMarkCount: facts.annualProjectedMarkCount,
        },
        provider: {
          currentError: facts.lane.currentError,
          failureCount: facts.lane.failureCount,
          nextEligibleAt: facts.lane.nextEligibleAt?.toISOString() ?? null,
          status: facts.lane.status,
        },
        source: {
          lastActivityAt: source.lastActivityAt?.toISOString() ?? null,
          physicalRecordCount: Number(source.physicalRecordCount),
          projectedMarkCount: Number(source.projectedMarkCount),
          unavailableArtifactCount: facts.unavailableArtifactCount,
        },
        summary: syncStatusFromFacts(facts),
      };
    },
  };
}
