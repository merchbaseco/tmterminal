import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Deploy-time guard: name-diffs the environment Docker baked into the running
 * containers against the schema's sensitivity split.
 *
 * For a Compose service the platform's "delivered copy" is the container spec
 * Docker writes at `up` time, so that is what gets inspected. Values enter this
 * process (they are part of the inspect output) but are split off at the first
 * `=` and never printed, logged, or returned — only names leave.
 *
 * The inspect output is read as JSON rather than line-split text: Trademark
 * Terminal delivers a multi-line PEM (MERCHBASE_CLERK_JWT_KEY), and a naive
 * line split turns each continuation line into a bogus "delivered name".
 *
 * Fails when a delivered name is not a schema item (a stale name surviving a
 * rename), or when a production-required sensitive item never reached the API
 * container.
 */
const apiContainer = "tmterminal-api-1";
const workerContainer = "tmterminal-worker-1";

// Production-required sensitive items that deliberately never reach the API
// container, with the reason. Everything else in that set must arrive there.
const notDeliveredToApi = new Map([
  [
    "TMTERMINAL_DATABASE_PASSWORD",
    "composed into TMTERMINAL_DATABASE_URL; the database container receives it as POSTGRES_PASSWORD",
  ],
  [
    "TMTERMINAL_USPTO_API_KEY",
    "read only by the worker, which ingests from the USPTO Open Data Portal",
  ],
]);

// Production-required sensitive items the worker must carry.
const requiredOnWorker = new Set(["TMTERMINAL_DATABASE_URL", "TMTERMINAL_USPTO_API_KEY"]);

// Names the runtime image sets for itself rather than receiving from the
// schema, plus the literal names the platform requires.
const imageProvidedNames = new Set([
  "BUN_INSTALL_BIN",
  "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
  "HOME",
  "HOSTNAME",
  "NODE_ENV",
  "PATH",
  "TERM",
]);

const schemaItemPattern = /^([A-Z][A-Z0-9_]*)=/u;

const schema = readFileSync(".env.schema", "utf8");
const declared = new Set<string>();
const sensitive = new Set<string>();
const requiredInProduction = new Set<string>();

let decorators = "";
for (const line of schema.split("\n")) {
  if (line.startsWith("#")) {
    decorators += ` ${line}`;
    continue;
  }

  const item = schemaItemPattern.exec(line);
  if (item) {
    const [, name] = item;
    if (!decorators.includes("@internal")) {
      declared.add(name);
      if (decorators.includes("@sensitive")) {
        sensitive.add(name);
        if (
          / @required(\s|$)/u.test(decorators) ||
          decorators.includes("@required=forEnv(production")
        ) {
          requiredInProduction.add(name);
        }
      }
    }
  }

  decorators = "";
}

const deliveredNamesFor = (container: string): string[] => {
  const inspected = spawnSync(
    "docker",
    ["inspect", container, "--format", "{{json .Config.Env}}"],
    {
      encoding: "utf8",
      env: process.env,
    }
  );

  if (inspected.status !== 0) {
    console.error(`Unable to inspect the ${container} container.`);
    console.error(inspected.stderr ?? "");
    process.exit(1);
  }

  let entries: string[];
  try {
    entries = JSON.parse(inspected.stdout ?? "[]");
  } catch {
    console.error(`Could not parse the environment of ${container}.`);
    process.exit(1);
  }

  // Split at the first `=` and discard the value immediately.
  return entries
    .map((entry) => entry.slice(0, entry.indexOf("=")))
    .filter((name) => name.length > 0 && !imageProvidedNames.has(name));
};

const failures: string[] = [];
const summaries: string[] = [];

for (const container of [apiContainer, workerContainer]) {
  const deliveredNames = deliveredNamesFor(container);

  for (const name of deliveredNames) {
    if (!declared.has(name)) {
      failures.push(
        `${container}: delivered variable ${name} is not a deliverable .env.schema item (stale name?).`
      );
    }
  }

  const deliveredSensitive = deliveredNames.filter((name) => sensitive.has(name)).length;
  summaries.push(
    `${container}: ${deliveredNames.length} variables (${deliveredSensitive} sensitive)`
  );

  // The API server carries every production-required item except the ones
  // listed above; the worker carries the narrower set it actually reads.
  const expected =
    container === apiContainer
      ? [...requiredInProduction].filter((name) => !notDeliveredToApi.has(name))
      : [...requiredOnWorker];

  for (const name of expected.sort()) {
    if (!deliveredNames.includes(name)) {
      failures.push(
        `${container}: production-required sensitive item ${name} never reached the container.`
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(
  `Delivered environment matches the schema — ${summaries.join("; ")}; ${requiredInProduction.size} production-required items checked against their expected containers.`
);
