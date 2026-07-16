import { createDatabaseClient } from "./db/client.ts";
import { quarantineArtifactVersion } from "./ingestion/artifact-quarantine.ts";
import { createLocalArtifactStore } from "./ingestion/local-artifact-store.ts";
import {
  recoverCorpusFrontier,
  recoverSourceLane,
  replayArtifactVersion,
  requestFullRebuild,
  selectArtifactVersion,
} from "./ingestion/sync-operations.ts";
import { extractZipXml } from "./ingestion/zip-artifact-xml.ts";

type SyncOperation =
  | { command: "full-rebuild" }
  | { command: "quarantine" | "select-reissue"; identifier: string; reason: string }
  | { command: "recover-frontier" }
  | { command: "recover-source-lane"; reason: string }
  | { command: "replay-parser"; identifier: string };

function identifierAndReason(args: string[], usage: string) {
  const [identifier, flag, reason] = args;
  if (args.length !== 3 || !identifier || flag !== "--reason" || !reason?.trim()) {
    throw new Error(usage);
  }
  return { identifier, reason: reason.trim() };
}

function sourceRecovery(args: string[]) {
  if (
    args.length !== 3 ||
    args[0] !== "--confirm-all-current-alerts" ||
    args[1] !== "--reason" ||
    !args[2]?.trim()
  ) {
    throw new Error(
      "Usage: sync:ops recover-source-lane --confirm-all-current-alerts --reason <reason>"
    );
  }
  return { reason: args[2].trim() };
}

export function parseSyncOperationArguments(argv: string[]): SyncOperation {
  const [command, ...args] = argv;
  if (command === "quarantine" || command === "select-reissue") {
    return {
      command,
      ...identifierAndReason(
        args,
        `Usage: sync:ops ${command} <artifact-version-id> --reason <reason>`
      ),
    };
  }
  if (command === "replay-parser") {
    if (args.length !== 1 || !args[0]) {
      throw new Error("Usage: sync:ops replay-parser <artifact-version-id>");
    }
    return { command, identifier: args[0] };
  }
  if (command === "recover-source-lane") {
    return { command, ...sourceRecovery(args) };
  }
  if (command === "recover-frontier") {
    if (args.length !== 0) {
      throw new Error("Usage: sync:ops recover-frontier");
    }
    return { command };
  }
  if (command === "full-rebuild") {
    if (args.length !== 1 || args[0] !== "--confirm-offline-rebuild") {
      throw new Error("Usage: sync:ops full-rebuild --confirm-offline-rebuild");
    }
    return { command };
  }
  throw new Error(
    "Commands: quarantine, select-reissue, replay-parser, recover-source-lane, recover-frontier, full-rebuild"
  );
}

async function main(operation: SyncOperation) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const database = createDatabaseClient(databaseUrl);
  const artifactStore = createLocalArtifactStore(
    process.env.ARTIFACT_STORE_ROOT ?? "/var/lib/tmturtle/artifacts"
  );
  try {
    let result: unknown;
    if (operation.command === "quarantine") {
      result = await quarantineArtifactVersion(database, operation.identifier, operation.reason);
    } else if (operation.command === "select-reissue") {
      result = await selectArtifactVersion(database, operation.identifier, operation.reason);
    } else if (operation.command === "replay-parser") {
      result = await replayArtifactVersion({
        artifactStore,
        artifactVersionId: operation.identifier,
        database,
        extractXml: extractZipXml,
      });
    } else if (operation.command === "recover-source-lane") {
      result = await recoverSourceLane(database, operation);
    } else if (operation.command === "recover-frontier") {
      result = await recoverCorpusFrontier(database);
    } else {
      result = await requestFullRebuild({
        database,
        databaseUrl,
        offlineConfirmed: process.env.TMTURTLE_OFFLINE_REBUILD === "1",
      });
    }
    console.log(JSON.stringify(result));
  } finally {
    await database.end({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main(parseSyncOperationArguments(process.argv.slice(2)));
}
