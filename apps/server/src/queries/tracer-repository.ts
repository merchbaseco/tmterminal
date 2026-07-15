import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import type { StoredArtifact } from "../ingestion/artifact-store.ts";
import type { ResolvedCanonicalMark } from "../ingestion/canonical-mark-types.ts";
import { replaceCanonicalMark } from "./canonical-mark-repository.ts";
import { lockCorpusPublication } from "./corpus-publication-lock.ts";

const tracerProduct = "TRTYRAP";
const tracerFilename = "prd-60-tracer-annual-2025-full-tx-60146682.xml";

export async function retainTracerArtifactVersion(database: postgres.Sql, artifact: StoredArtifact) {
  return database.begin(async (transaction) => {
    await transaction`
      insert into dataset_product (id)
      values (${tracerProduct})
      on conflict (id) do nothing
    `;
    const [logicalArtifact] = await transaction<[{ id: string }]>`
      with inserted as (
        insert into artifact (id, product_id, filename)
        values (${randomUUID()}, ${tracerProduct}, ${tracerFilename})
        on conflict (product_id, filename) do nothing
        returning id
      )
      select id from inserted
      union all
      select id from artifact
      where product_id = ${tracerProduct} and filename = ${tracerFilename}
      limit 1
    `;
    if (!logicalArtifact) throw new Error("Tracer artifact upsert returned no row");

    const [version] = await transaction<[{ id: string }]>`
      with inserted as (
        insert into artifact_version (id, artifact_id, sha256, bytes, object_key)
        values (${randomUUID()}, ${logicalArtifact.id}, ${artifact.sha256}, ${artifact.bytes}, ${artifact.objectKey})
        on conflict (artifact_id, sha256) do nothing
        returning id
      )
      select id from inserted
      union all
      select id from artifact_version
      where artifact_id = ${logicalArtifact.id} and sha256 = ${artifact.sha256}
      limit 1
    `;
    if (!version) throw new Error("Tracer artifact version upsert returned no row");
    return version.id;
  });
}

export async function replaceTracerCanonicalMark(database: postgres.Sql, materialization: ResolvedCanonicalMark) {
  await database.begin(async (transaction) => {
    await lockCorpusPublication(transaction);
    const [corpus] = await transaction<[{ publicationId: string | null }]>`
      select publication_id as "publicationId" from corpus_state where id = 'uspto'
    `;
    if (corpus?.publicationId) return;
    await replaceCanonicalMark(transaction, materialization);
  });
}
