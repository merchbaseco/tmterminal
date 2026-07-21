import { basename } from "node:path";

import { createDatabaseClient } from "./db/client.ts";
import { createLocalArtifactStore } from "./ingestion/local-artifact-store.ts";
import {
  importSourceArtifact,
  inspectSourceArtifact,
  repairSourceArtifact,
  type SourceInspectionFacts,
  type SourceRepairFacts,
} from "./ingestion/source-repair.ts";

interface Input {
  action: "import" | "inspect" | "promote" | "reacquire" | "replay";
  filename: string;
  importPath: string | null;
  product: string;
}

const usage =
  "Usage: bun run source:repair --product <product> --filename <filename> [--promote|--reacquire|--replay|--import <path>]";

function parseInput(args: string[]): Input {
  if (args[0] !== "--product" || args[2] !== "--filename") {
    throw new Error(usage);
  }
  const [, productValue, , filenameValue, actionFlag, importPathValue] = args;
  const product = productValue?.trim();
  const filename = filenameValue?.trim();
  if (!(product && filename)) {
    throw new Error(usage);
  }
  let action: Input["action"] = "inspect";
  let importPath: string | null = null;
  if (actionFlag === "--reacquire") {
    action = "reacquire";
  } else if (actionFlag === "--promote") {
    action = "promote";
  } else if (actionFlag === "--replay") {
    action = "replay";
  } else if (actionFlag === "--import" && importPathValue) {
    action = "import";
    importPath = importPathValue;
  } else if (actionFlag !== undefined) {
    throw new Error(usage);
  }
  let expectedLength = 5;
  if (action === "import") {
    expectedLength = 6;
  } else if (action === "inspect") {
    expectedLength = 4;
  }
  if (args.length !== expectedLength) {
    throw new Error(usage);
  }
  if (importPath && basename(importPath) !== filename) {
    throw new Error("Imported file name must exactly match the Source Artifact filename");
  }
  return {
    action,
    filename,
    importPath,
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
  let result: SourceInspectionFacts | SourceRepairFacts;
  if (input.action === "inspect") {
    result = await inspectSourceArtifact(artifactStore, database, identity);
  } else if (input.action === "import") {
    if (!input.importPath) {
      throw new Error(usage);
    }
    const file = Bun.file(input.importPath);
    if (!(await file.exists())) {
      throw new Error(`Imported file not found: ${input.importPath}`);
    }
    result = await importSourceArtifact(artifactStore, database, {
      ...identity,
      body: file.stream(),
    });
  } else {
    result = await repairSourceArtifact(artifactStore, database, {
      ...identity,
      action: input.action,
    });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await database.end({ timeout: 1 });
}
