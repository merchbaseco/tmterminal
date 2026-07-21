import type postgres from "postgres";

import type { OperatorSyncService } from "../api/contracts.ts";
import { readTrademarkIngestionStatus } from "../ingestion/trademark-ingestion.ts";
import {
  readOperatorArtifacts,
  readOperatorAttentionArtifacts,
  readOperatorCatalogSummary,
  readOperatorProcessingActivity,
  readOperatorSourceSummary,
  readOperatorWorkerAttention,
} from "../queries/operator-sync-repository.ts";

const safeError = (value: string | null) =>
  value?.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500) ?? null;
const attentionLimit = 20;

async function readPublicStatus(database: postgres.TransactionSql) {
  const [facts, source, catalog] = await Promise.all([
    readTrademarkIngestionStatus(database),
    readOperatorSourceSummary(database),
    readOperatorCatalogSummary(database),
  ]);
  const processingActivity = await readOperatorProcessingActivity(database);
  return {
    attentionCount: source.attentionCount,
    status: {
      catalog,
      source: {
        currentArtifact: facts.currentArtifact,
        lastActivityAt: source.lastActivityAt?.toISOString() ?? null,
        latestProcessedDate: source.latestProcessedDate,
        processingActivity,
      },
    },
  } as const;
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
            applicationCompletedAt: item.applicationCompletedAt?.toISOString() ?? null,
            bytes: item.bytes === null ? null : Number(item.bytes),
            currentError: safeError(item.currentError),
            downloadedAt: item.downloadedAt?.toISOString() ?? null,
            updatedAt: item.updatedAt.toISOString(),
          })),
          limit: input.limit,
          offset: input.offset,
          total: page.total,
        };
      });
    },
    publicStatus() {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        return (await readPublicStatus(transaction)).status;
      });
    },
    status() {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const [summary, sourceAttentionItems, workerAttention] = await Promise.all([
          readPublicStatus(transaction),
          readOperatorAttentionArtifacts(transaction, attentionLimit),
          readOperatorWorkerAttention(transaction),
        ]);
        const attentionItems = [workerAttention, ...sourceAttentionItems]
          .filter((item) => item !== null)
          .slice(0, attentionLimit);
        return {
          attention: {
            items: attentionItems.map((item) => ({
              ...item,
              message: safeError(item.message),
              retryNotBefore: item.retryNotBefore?.toISOString() ?? null,
              updatedAt: item.updatedAt.toISOString(),
            })),
            total: summary.attentionCount + (workerAttention ? 1 : 0),
          },
          ...summary.status,
        };
      });
    },
  };
}
