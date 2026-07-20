import type postgres from "postgres";

import type { OperatorSyncService } from "../api/contracts.ts";
import { readTrademarkIngestionStatus } from "../ingestion/trademark-ingestion.ts";
import {
  readOperatorArtifacts,
  readOperatorAttentionArtifacts,
  readOperatorCatalogSummary,
  readOperatorProcessingActivity,
  readOperatorSourceSummary,
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
    providerStatus: facts.lane.status,
    status: {
      catalog,
      source: {
        currentArtifact: facts.currentArtifact
          ? {
              filename: facts.currentArtifact.filename,
              state:
                facts.currentArtifact.state === "projecting"
                  ? ("processing" as const)
                  : ("downloading" as const),
            }
          : null,
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
    publicStatus() {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        return (await readPublicStatus(transaction)).status;
      });
    },
    status() {
      return database.begin(async (transaction) => {
        await transaction`set transaction isolation level repeatable read`;
        const [summary, attentionItems] = await Promise.all([
          readPublicStatus(transaction),
          readOperatorAttentionArtifacts(transaction, attentionLimit),
        ]);
        return {
          attention: {
            items: attentionItems.map((item) => ({
              ...item,
              updatedAt: item.updatedAt.toISOString(),
            })),
            total: summary.attentionCount,
          },
          provider: {
            status: summary.providerStatus,
          },
          ...summary.status,
        };
      });
    },
  };
}
