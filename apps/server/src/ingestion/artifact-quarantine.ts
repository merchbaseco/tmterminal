import type postgres from "postgres";

import { lockCorpusPublication } from "../queries/corpus-publication-lock.ts";

export async function quarantineArtifactVersion(database: postgres.Sql, artifactVersionId: string, reason: string) {
  return database.begin(async (transaction) => {
    await lockCorpusPublication(transaction);
    const [version] = await transaction<Array<{ id: string }>>`
      update artifact_version set state = 'quarantined', quarantined_at = now(), quarantine_reason = ${reason}
      where id = ${artifactVersionId} and state in ('verified', 'staged')
      returning id
    `;
    if (!version) throw new Error("Artifact version must exist in verified or staged state");
    await transaction`
      delete from artifact_version_selection
      where artifact_version_id = ${artifactVersionId}
    `;
    return version;
  });
}
