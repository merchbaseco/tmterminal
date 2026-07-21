import { createDatabaseClient } from "./db/client.ts";
import { createLocalArtifactStore } from "./ingestion/local-artifact-store.ts";
import { inspectSourceArtifact, repairSourceArtifact } from "./ingestion/source-repair.ts";

interface Input {
  action: "inspect" | "reacquire" | "replay";
  filename: string;
  product: string;
}

function parseInput(args: string[]): Input {
  if (
    (args.length !== 4 && args.length !== 5) ||
    args[0] !== "--product" ||
    args[2] !== "--filename"
  ) {
    throw new Error(
      "Usage: bun run source:repair --product <product> --filename <filename> [--reacquire|--replay]"
    );
  }
  const [, productValue, , filenameValue, actionFlag] = args;
  const product = productValue?.trim();
  const filename = filenameValue?.trim();
  if (
    !(product && filename) ||
    (actionFlag !== undefined && actionFlag !== "--reacquire" && actionFlag !== "--replay")
  ) {
    throw new Error(
      "Usage: bun run source:repair --product <product> --filename <filename> [--reacquire|--replay]"
    );
  }
  let action: Input["action"] = "inspect";
  if (actionFlag === "--reacquire") {
    action = "reacquire";
  } else if (actionFlag === "--replay") {
    action = "replay";
  }
  return {
    action,
    filename,
    product,
  };
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const input = parseInput(Bun.argv.slice(2));
const database = createDatabaseClient(databaseUrl);
const artifactStore = createLocalArtifactStore(
  process.env.ARTIFACT_STORE_ROOT ?? "/var/lib/tmturtle/artifacts"
);

try {
  const identity = { filename: input.filename, product: input.product };
  const result =
    input.action === "inspect"
      ? await inspectSourceArtifact(artifactStore, database, identity)
      : await repairSourceArtifact(artifactStore, database, { ...identity, action: input.action });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await database.end({ timeout: 1 });
}
