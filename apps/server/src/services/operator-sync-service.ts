import type postgres from "postgres";

import type { OperatorSyncService } from "../api/contracts.ts";
import { readTrademarkIngestionStatus } from "../ingestion/trademark-ingestion.ts";
import { readOperatorArtifacts } from "../queries/operator-sync-repository.ts";
import { syncStatusFromFacts } from "./sync-service.ts";

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
            completedAt: item.completedAt?.toISOString() ?? null,
            currentError:
              item.currentError?.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500) ?? null,
            updatedAt: item.updatedAt.toISOString(),
          })),
          limit: input.limit,
          offset: input.offset,
          total: page.total,
        };
      });
    },
    async status() {
      const facts = await readTrademarkIngestionStatus(database);
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
        summary: syncStatusFromFacts(facts),
      };
    },
  };
}
