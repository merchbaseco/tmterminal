import { createDatabaseClient } from "./db/client.ts";
import { createLocalArtifactStore } from "./ingestion/local-artifact-store.ts";
import { materializeTracer } from "./services/tracer-service.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const artifactStoreRoot = process.env.ARTIFACT_STORE_ROOT;
if (!artifactStoreRoot) throw new Error("ARTIFACT_STORE_ROOT is required");

const database = createDatabaseClient(databaseUrl);
try {
  const tracer = await materializeTracer({
    artifactStore: createLocalArtifactStore(artifactStoreRoot),
    database,
  });
  process.stdout.write(`${JSON.stringify({ status: "materialized", tracer })}\n`);
} finally {
  await database.end({ timeout: 1 });
}
