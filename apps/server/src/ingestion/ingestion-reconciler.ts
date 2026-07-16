import type postgres from "postgres";

import {
  artifactObjectHasReference,
  findArtifactObjectForCleanup,
  findArtifactVersionForParsing,
  releaseArtifactObjectReference,
} from "../queries/artifact-repository.ts";
import { quarantineArtifactVersion } from "./artifact-quarantine.ts";
import type { ArtifactStore } from "./artifact-store.ts";
import { createCorpusPublisher } from "./corpus-publisher.ts";
import { createSourceObservationModule } from "./source-observations.ts";
import { ArtifactArchiveError } from "./zip-artifact-xml.ts";

interface ArtifactScheduler {
  runOnce: () => Promise<{ status: string } & Record<string, unknown>>;
}
export function createIngestionReconciler(options: {
  artifactScheduler: ArtifactScheduler;
  artifactStore: Pick<ArtifactStore, "get" | "listObjectKeys" | "remove">;
  database: postgres.Sql;
  extractXml: (archive: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}) {
  const observations = createSourceObservationModule(options.database);
  const publisher = createCorpusPublisher(options.database);
  let startupObjectSweepPending = true;

  async function releaseArtifactObject(artifact: { artifactVersionId: string; objectKey: string }) {
    const removeObject = await releaseArtifactObjectReference(
      options.database,
      artifact.artifactVersionId,
      artifact.objectKey
    );
    if (removeObject) {
      try {
        await options.artifactStore.remove(artifact.objectKey);
      } catch (error) {
        startupObjectSweepPending = true;
        throw error;
      }
    }
  }

  async function removeOrphanArtifactObjects() {
    let removed = 0;
    for await (const objectKey of options.artifactStore.listObjectKeys()) {
      if (await artifactObjectHasReference(options.database, objectKey)) {
        continue;
      }
      await options.artifactStore.remove(objectKey);
      removed += 1;
    }
    return removed;
  }

  return {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One ordered reconciliation action preserves publication, cleanup, parse, and source priority.
    async reconcile() {
      if (startupObjectSweepPending) {
        const removed = await removeOrphanArtifactObjects();
        startupObjectSweepPending = false;
        if (removed > 0) {
          return { action: "orphan-cleanup" as const, removed };
        }
      }

      const cleanup = await findArtifactObjectForCleanup(options.database);
      if (cleanup) {
        await releaseArtifactObject(cleanup);
        return { action: "cleanup" as const, artifactVersionId: cleanup.artifactVersionId };
      }

      const candidate = await publisher.stage();
      if (candidate.status === "staged") {
        return {
          action: "publication" as const,
          publicationId: candidate.candidateId,
          result: await publisher.publish(candidate.candidateId),
        };
      }

      const artifact = await findArtifactVersionForParsing(options.database);
      if (artifact) {
        let archive: ReadableStream<Uint8Array>;
        try {
          archive = await options.artifactStore.get(artifact.objectKey);
        } catch {
          const reason = "Retained artifact bytes could not be read";
          await quarantineArtifactVersion(options.database, artifact.artifactVersionId, reason);
          await releaseArtifactObject(artifact);
          return {
            action: "quarantine" as const,
            artifactVersionId: artifact.artifactVersionId,
            reason,
          };
        }
        try {
          const result = await observations.stageArtifact({
            artifactVersionId: artifact.artifactVersionId,
            xml: options.extractXml(archive),
          });
          await releaseArtifactObject(artifact);
          return {
            action: "parse" as const,
            artifactVersionId: artifact.artifactVersionId,
            result,
          };
        } catch (error) {
          if (!(error instanceof ArtifactArchiveError)) {
            throw error;
          }
          await quarantineArtifactVersion(
            options.database,
            artifact.artifactVersionId,
            error.message
          );
          await releaseArtifactObject(artifact);
          return {
            action: "quarantine" as const,
            artifactVersionId: artifact.artifactVersionId,
            reason: error.message,
          };
        }
      }

      const source = await options.artifactScheduler.runOnce();
      return { action: "source" as const, source };
    },
  };
}
