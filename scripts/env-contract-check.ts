import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Name-only contract check across the four places a Trademark Terminal variable
 * appears: `.env.schema` (the contract), the bare `process.env.X` /
 * `import.meta.env.X` reads in the shipped source, the Compose delivery for the
 * migrate/api/worker/integration-test containers, and the build arguments
 * declared as `ARG` in the Dockerfile.
 *
 * There is no typed env module, so the source scan IS the consumer side: every
 * name the code reads must be a deliverable schema item and must actually be
 * delivered to the container that reads it. `varlock audit` cannot do this — it
 * does not see Compose or Docker at all. Nothing here resolves a value or
 * contacts 1Password; it compares names and decorators only.
 */
const repositoryRoot = process.cwd();
const schemaPath = join(repositoryRoot, ".env.schema");
const composePath = join(repositoryRoot, "compose.yml");
const dockerfilePath = join(repositoryRoot, "Dockerfile");

// Injected by varlock itself rather than delivered to any consumer.
const varlockBuiltins = new Set(["VARLOCK_ENV"]);

const schemaItemPattern = /^([A-Z][A-Z0-9_]*)=/u;
const envReadPattern = /^.*\.env\./u;
const composeEntryPattern = /^\s*(?:-\s*([A-Z][A-Z0-9_]*)(?:[:=]|\s*$)|([A-Z][A-Z0-9_]*)[:=])/u;
const dockerfileArgPattern = /^ARG\s+([A-Z][A-Z0-9_]*)/gmu;
const nonSpacePattern = /\S/u;

// Literal names the platform itself requires. Compose delivers them to the
// database and runtime containers, never sourced from a schema item of the same
// name, so they are exempt from both directions of the check.
const platformLiteralNames = new Set([
  "POSTGRES_DB",
  "POSTGRES_PASSWORD",
  "POSTGRES_USER",
  // The container's own lifecycle signal. VARLOCK_ENV is a varlock builtin and
  // is never delivered, so in-container branching reads this instead.
  "NODE_ENV",
]);

// Read on end users' machines by the published @tmterminal/cli, or provided by
// the runtime/bundler for its own purposes. Out of the schema by design:
// renaming one would break a published contract or the tooling itself.
const outOfContractNames = new Set([
  "MERCHBASE_API_KEY",
  "TMTERMINAL_BASE_URL",
  "DEV",
  // Supplied by GitHub Actions to the deploy script; not part of this repo's
  // environment contract.
  "GITHUB_SHA",
  "HOME",
  "NODE_ENV",
  "PATH",
]);

// Schema items that deliberately never reach a container, with the reason.
// Anything not listed here that container code reads must be delivered.
const notDeliveredNames = new Map([
  [
    "TMTERMINAL_API_PORT",
    "host port binding and Vite dev-server proxy target, not a container value",
  ],
  ["TMTERMINAL_WEB_PORT", "host port binding, not a container value"],
  ["TMTERMINAL_DATABASE_PUBLISHED_PORT", "host port binding for the database container"],
  ["TMTERMINAL_DATABASE_HOST", "composed into TMTERMINAL_DATABASE_URL before delivery"],
  ["TMTERMINAL_DATABASE_PORT", "composed into TMTERMINAL_DATABASE_URL before delivery"],
  [
    "TMTERMINAL_DATABASE_NAME",
    "composed into the URL; reaches the database container as POSTGRES_DB",
  ],
  [
    "TMTERMINAL_DATABASE_USER",
    "composed into the URL; reaches the database container as POSTGRES_USER",
  ],
  [
    "TMTERMINAL_DATABASE_PASSWORD",
    "composed into the URL; reaches the database container as POSTGRES_PASSWORD",
  ],
  [
    "TMTERMINAL_DEV_CLERK_SIGN_IN_USER_ID",
    "development-only sign-in endpoint; never delivered to production",
  ],
  ["TMTERMINAL_DEV_HOST", "development server bind address, not a container value"],
  [
    "TMTERMINAL_DEV_OPERATOR_MERCHBASE_USER_ID",
    "development-only operator surface; never delivered to production",
  ],
  ["TMTERMINAL_REVISION", "build argument and image tag, not a runtime value"],
  ["VITE_MERCHBASE_CLERK_PUBLISHABLE_KEY", "build-time website input, passed as a build argument"],
  ["VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN", "build-time website input, development only"],
  ["MERCHBASE_CLERK_ISSUER", "delivered to the api and worker containers"],
]);

interface SchemaItem {
  hasExplicitSensitivity: boolean;
  isInternal: boolean;
  isSensitive: boolean;
  name: string;
}

const readSchemaItems = (): SchemaItem[] => {
  const contents = readFileSync(schemaPath, "utf8");
  const dividerIndex = contents.indexOf("\n# ---");
  const body = dividerIndex === -1 ? contents : contents.slice(dividerIndex + 6);

  const items: SchemaItem[] = [];
  let decorators: string[] = [];

  for (const line of body.split("\n")) {
    if (line.startsWith("#")) {
      decorators.push(line);
      continue;
    }

    const match = schemaItemPattern.exec(line);
    if (match) {
      const attached = decorators.join(" ");
      items.push({
        hasExplicitSensitivity: attached.includes("@sensitive") || attached.includes("@public"),
        isInternal: attached.includes("@internal"),
        isSensitive: attached.includes("@sensitive"),
        name: match[1],
      });
    }

    // A blank line (or the item itself) breaks decorator association.
    decorators = [];
  }

  return items;
};

const sourceScanArgs = [
  "apps",
  "packages",
  "scripts",
  "--include=*.ts",
  "--include=*.tsx",
  "--exclude=*.test.ts",
  "--exclude=*.test.tsx",
  "--exclude=*.d.ts",
  "--exclude-dir=node_modules",
  "--exclude-dir=dist",
  // This file names variables in prose; scanning it would report its own comments.
  "--exclude=env-contract-check.ts",
];

const grepSource = (args: string[], paths: string[] = sourceScanArgs): string => {
  try {
    return execFileSync("grep", [...args, ...paths], { cwd: repositoryRoot, encoding: "utf8" });
  } catch {
    // grep exits 1 when nothing matches.
    return "";
  }
};

// Direct `process.env.X` / `import.meta.env.X` reads. Used to catch code
// reading a name the schema does not declare.
const readExplicitSourceNames = (): Set<string> => {
  const output = grepSource(["-rhoE", "(process|import\\.meta)\\.env\\.[A-Z][A-Z0-9_]*"]);
  const names = new Set<string>();
  for (const match of output.split("\n")) {
    const name = match.replace(envReadPattern, "").trim();
    if (name) {
      names.add(name);
    }
  }
  return names;
};

// Whether a name appears anywhere in the shipped source. Some values are read
// indirectly — `requiredEnvironment("NAME")`, `milliseconds("NAME", …)` — so a
// `process.env.` scan alone would wrongly call them unused.
const isMentionedInSource = (name: string): boolean => grepSource(["-rlF", name]).trim().length > 0;

// Same question across every venue that legitimately consumes a name: the test
// suites, Compose, the Dockerfile, the shell scripts, the agent environments,
// and CI. A variable interpolated by compose.yml or exported by a deploy script
// has a real consumer even though no TypeScript file mentions it.
const consumerPaths = [
  "apps",
  "packages",
  "scripts",
  ".cursor",
  ".codex",
  ".github",
  "compose.yml",
  "Dockerfile",
  ".npmrc",
  "bunfig.toml",
  "package.json",
];

const isMentionedAnywhere = (name: string): boolean =>
  isMentionedInSource(name) ||
  grepSource(
    [
      "-rlF",
      name,
      "--exclude-dir=node_modules",
      "--exclude-dir=dist",
      "--exclude=env-contract-check.ts",
    ],
    consumerPaths
  ).trim().length > 0;

// Compose is indentation-structured, so a block ends at the first line indented
// no deeper than its header. Every matching block is read, because
// `environment:` appears once per service.
const readComposeBlocks = (blockHeader: string, headerIndent: number) => {
  const lines = readFileSync(composePath, "utf8").split("\n");
  const names: string[] = [];
  let inside = false;

  for (const line of lines) {
    const indent = line.search(nonSpacePattern);
    const isHeader = line.trimEnd().endsWith(blockHeader) && indent === headerIndent;

    if (!inside) {
      inside = isHeader;
      continue;
    }

    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }

    if (indent <= headerIndent) {
      inside = isHeader;
      continue;
    }

    const match = composeEntryPattern.exec(line);
    if (match) {
      names.push(match[1] ?? match[2]);
    }
  }

  return names;
};

// Names one schema item references inside another item's value expression
// (`${NAME}` / `$NAME`). Composing TMTERMINAL_DATABASE_URL out of its parts
// makes those parts consumed, even though no file outside the schema names them.
const readSchemaReferencedNames = (): Set<string> => {
  const contents = readFileSync(schemaPath, "utf8");
  const names = new Set<string>();
  for (const match of contents.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\}?/gu)) {
    names.add(match[1]);
  }
  return names;
};

const readDockerfileArgs = (): string[] =>
  [...readFileSync(dockerfilePath, "utf8").matchAll(dockerfileArgPattern)].map((match) => match[1]);

const sorted = (names: Iterable<string>) => [...names].sort();

const schemaItems = readSchemaItems();
const deliverableNames = new Set(
  schemaItems
    .filter((item) => !(item.isInternal || varlockBuiltins.has(item.name)))
    .map((item) => item.name)
);
const explicitSourceNames = readExplicitSourceNames();
const composeEnvNames = new Set(readComposeBlocks("environment:", 4));
const composeBuildArgNames = new Set(readComposeBlocks("args:", 6));
const dockerfileArgNames = new Set(readDockerfileArgs());
const schemaReferencedNames = readSchemaReferencedNames();

const issues: string[] = [];

// 1. Sensitivity must be stated, not inherited. The schema defaults to
//    sensitive, so an unmarked item is safe but ambiguous to readers.
for (const item of schemaItems) {
  if (!item.hasExplicitSensitivity) {
    issues.push(`${item.name} does not declare @sensitive or @public in .env.schema.`);
  }
}

// 2. A VITE_ value is inlined into a public browser bundle at build time.
//    Marking one sensitive means a secret is about to ship to every visitor.
for (const item of schemaItems) {
  if (item.name.startsWith("VITE_") && item.isSensitive) {
    issues.push(
      `${item.name} is @sensitive but VITE_ values are inlined into the public website bundle.`
    );
  }
}

// 3. Everything the shipped source reads must be a deliverable schema item, and
//    must actually be delivered unless it is listed as deliberately undelivered.
for (const name of sorted(explicitSourceNames)) {
  if (outOfContractNames.has(name) || name.startsWith("VITE_")) {
    continue;
  }

  if (!deliverableNames.has(name)) {
    issues.push(`${name} is read by the source but is not a deliverable .env.schema item.`);
  } else if (!(composeEnvNames.has(name) || notDeliveredNames.has(name))) {
    issues.push(
      `${name} is read by the source but is not delivered in any compose \`environment:\` block.`
    );
  }
}

// 4. Compose must not deliver names nothing reads, or names outside the schema.
for (const name of sorted(composeEnvNames)) {
  if (platformLiteralNames.has(name)) {
    continue;
  }

  if (!deliverableNames.has(name)) {
    issues.push(`${name} is delivered by compose but is not a deliverable .env.schema item.`);
  }

  if (!isMentionedAnywhere(name)) {
    issues.push(`${name} is delivered by compose but is not read anywhere in the repository.`);
  }
}

// 4b. Every deliverable schema item should have a consumer somewhere.
for (const item of schemaItems) {
  if (item.isInternal || varlockBuiltins.has(item.name) || !deliverableNames.has(item.name)) {
    continue;
  }

  if (
    !(
      isMentionedAnywhere(item.name) ||
      schemaReferencedNames.has(item.name) ||
      composeEnvNames.has(item.name) ||
      composeBuildArgNames.has(item.name)
    )
  ) {
    issues.push(`${item.name} is declared in .env.schema but nothing reads or delivers it.`);
  }
}

// 5. Build arguments must be declared on both sides. Docker silently drops a
//    build argument the Dockerfile never declares.
for (const name of sorted(composeBuildArgNames)) {
  if (!dockerfileArgNames.has(name)) {
    issues.push(
      `${name} is passed as a compose build argument but is not declared as an ARG in Dockerfile (Docker would silently discard it).`
    );
  }

  if (!deliverableNames.has(name)) {
    issues.push(
      `${name} is passed as a compose build argument but is not a deliverable .env.schema item.`
    );
  }
}

for (const name of sorted(dockerfileArgNames)) {
  if (!composeBuildArgNames.has(name)) {
    issues.push(`${name} is declared as an ARG in Dockerfile but is never passed by compose.`);
  }
}

if (issues.length > 0) {
  console.error("Environment contract is out of sync:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(
  `Environment contract is in sync (${deliverableNames.size} deliverable schema variables, ${explicitSourceNames.size} read directly by the source, ${composeEnvNames.size} delivered by compose, ${dockerfileArgNames.size} build arguments).`
);
