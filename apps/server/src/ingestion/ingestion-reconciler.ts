import type postgres from "postgres";

import { findArtifactVersionForParsing } from "../queries/artifact-repository.ts";
import type { ArtifactStore } from "./artifact-store.ts";
import { createCorpusPublisher } from "./corpus-publisher.ts";
import { createSourceObservationModule } from "./source-observations.ts";
import { quarantineArtifactVersion } from "./artifact-quarantine.ts";
import { ArtifactArchiveError } from "./zip-artifact-xml.ts";

type ArtifactScheduler = { runOnce(): Promise<{ status: string } & Record<string, unknown>> };
export function createIngestionReconciler(options: {
  artifactScheduler: ArtifactScheduler;
  artifactStore: Pick<ArtifactStore, "get">;
  database: postgres.Sql;
  extractXml: (archive: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}) {
  const observations = createSourceObservationModule(options.database);
  const publisher = createCorpusPublisher(options.database);

  return {
    async reconcile() {
      const artifact = await findArtifactVersionForParsing(options.database);
      if (artifact) {
        let archive: ReadableStream<Uint8Array>;
        try {
          archive = await options.artifactStore.get(artifact.objectKey);
        } catch {
          const reason = "Retained artifact bytes could not be read";
          await quarantineArtifactVersion(options.database, artifact.artifactVersionId, reason);
          return { action: "quarantine" as const, artifactVersionId: artifact.artifactVersionId, reason };
        }
        try {
          const result = await observations.stageArtifact({
            artifactVersionId: artifact.artifactVersionId,
            xml: options.extractXml(archive),
          });
          return { action: "parse" as const, artifactVersionId: artifact.artifactVersionId, result };
        } catch (error) {
          if (!(error instanceof ArtifactArchiveError)) throw error;
          await quarantineArtifactVersion(options.database, artifact.artifactVersionId, error.message);
          return { action: "quarantine" as const, artifactVersionId: artifact.artifactVersionId, reason: error.message };
        }
      }

      const candidate = await publisher.stage();
      if (candidate.status === "staged") {
        return {
          action: "publication" as const,
          publicationId: candidate.candidateId,
          result: await publisher.publish(candidate.candidateId),
        };
      }

      const source = await options.artifactScheduler.runOnce();
      return { action: "source" as const, source };
    },
  };
}
