import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * The production deploy runs under the deploy-agent role: every venue that
 * deploys supplies its own 1Password identity under
 * DEPLOY_AGENT_PRODUCTION_OP_TOKEN. The self-hosted GitHub Actions runner on
 * the Mac mini injects the GitHub deploy agent's token as a repository secret —
 * the preferred path. When no identity is present this is a supervised operator
 * run, so the script re-execs itself under `op run`, resolving the Mac Mini
 * identity through 1Password desktop authorization.
 *
 * Delivery is Docker Compose: the schema resolves into the process environment
 * and Compose reads each value straight from there. No `--env-file`, and no
 * generated plaintext env file anywhere in this path.
 *
 * Runtime steps run under `varlock run`. The image build cannot, because
 * `varlock run` strips @internal items and the build needs the install tokens —
 * so it gets an explicitly constructed environment instead.
 */
const bootstrapName = "DEPLOY_AGENT_PRODUCTION_OP_TOKEN";
const operatorIdentity = "op://Automation/Production Varlock - Mac Mini/credential";
const projectName = "tmterminal";
const varlockVersion = "1.16.1";

const dryRun = process.argv.includes("--dry-run");

// A leftover .env in the deploy checkout silently poisons the whole resolution:
// varlock loads it at higher precedence than the schema, so its stale values
// win, its `$` sequences are parsed as ref() expressions, and — once one item
// fails to parse — every op() reference in the file reports "Unable to
// authenticate with 1Password". That is how a superseded .env took another
// repo's production down after its migration.
if (existsSync(".env")) {
  console.error(
    "A .env file exists in the deploy checkout. Varlock loads it at higher precedence than .env.schema, " +
      "which silently overrides resolved values and breaks op() resolution. Remove it before deploying — " +
      "every value it held now lives in 1Password."
  );
  process.exit(1);
}

const environment: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [join(process.cwd(), "node_modules", ".bin"), process.env.PATH ?? ""].join(delimiter),
  // The schema's `@currentEnv=$VARLOCK_ENV` otherwise falls back to varlock's
  // own inference, which resolves `development` anywhere outside CI. That would
  // deliver Development-vault credentials to the production stack, so the
  // production lifecycle is pinned here rather than left to the caller's shell.
  VARLOCK_ENV: "production",
};

if (!process.env[bootstrapName]) {
  const reexec = spawnSync(
    "op",
    ["run", "--", "bun", process.argv[1] ?? "", ...process.argv.slice(2)],
    {
      env: { ...environment, [bootstrapName]: operatorIdentity },
      stdio: "inherit",
    }
  );
  process.exit(reexec.status ?? 1);
}

const run = (command: string, args: string[], env = environment) =>
  spawnSync(command, args, { env, stdio: "inherit" });

const capture = (command: string, args: string[], env = environment) => {
  const result = spawnSync(command, args, { encoding: "utf8", env });
  return result.status === 0 ? (result.stdout ?? "").trim() : "";
};

const varlockRun = (args: string[], env = environment) =>
  run("bunx", [`varlock@${varlockVersion}`, "run", "--", ...args], env);

// The exact-revision gate: refuses a dirty checkout, a HEAD that differs from
// the dispatched commit, or a HEAD that is not origin/main.
const expectedRevision = process.env.GITHUB_SHA || capture("git", ["rev-parse", "HEAD"]);
const revision = capture("./scripts/deployment-revision", [expectedRevision]);
if (!revision) {
  console.error("Refusing to deploy: the checkout failed the exact-revision gate.");
  process.exit(1);
}
environment.TMTERMINAL_REVISION = revision;

// The centralized-auth cleanup is complete in production; the migration step
// below assumes the final schema. Any other state means this checkout does not
// match the database and must not be deployed automatically.
const cleanupState = capture("./scripts/auth-cleanup-inventory", ["state"]);
if (cleanupState !== "final") {
  console.error(
    `Refusing to deploy: auth cleanup state is "${cleanupState || "unknown"}", expected "final".`
  );
  process.exit(1);
}

// The image build needs two things at once: every @public value Compose
// interpolates (ports, database identifiers, build arguments) and the two
// @internal install credentials Compose mounts as BuildKit secrets. `varlock
// run` supplies the first and strips the second, so the build runs inside a
// varlock child that re-resolves the credentials for itself — the same shape
// scripts/compose uses. --include-internal keeps the bootstrap token in that
// child so the nested resolution has an identity.
// VARLOCK_SPEC pins the nested resolution inside scripts/install-tokens. The
// deploy checkout has no node_modules, so a bare `bunx varlock` there would
// silently fetch whatever is newest on npm in the middle of a production
// deploy.
const buildCommand =
  `VARLOCK_SPEC="varlock@${varlockVersion}" . ./scripts/install-tokens; ` +
  `exec docker compose --project-name ${projectName} `;

const composeArgs = ["--project-name", projectName];

// Dry run stops here: rendering the Compose configuration forces every op()
// reference in the schema to resolve and every `${VAR}` in compose.yml to
// interpolate, so a missing 1Password item or an unset name fails before
// anything is built or replaced.
if (dryRun) {
  const rendered = spawnSync(
    "bunx",
    [
      `varlock@${varlockVersion}`,
      "run",
      "--include-internal",
      "--",
      "sh",
      "-c",
      `${buildCommand}config`,
    ],
    { encoding: "utf8", env: environment }
  );

  if (rendered.status !== 0) {
    console.error("Dry run failed to render the Compose configuration.");
    console.error(rendered.stderr ?? "");
    process.exit(rendered.status ?? 1);
  }

  // The rendered document contains resolved secrets, so only its shape is
  // reported — never its contents.
  const services = [...(rendered.stdout ?? "").matchAll(/^ {2}([a-z][a-z0-9-]*):$/gmu)].map(
    (match) => match[1]
  );
  console.log(
    `Dry run OK: schema resolved at revision ${revision} and Compose rendered ${services.length} services (${services.join(", ")}).`
  );
  process.exit(0);
}

console.log(`Deploying revision ${revision}.`);
console.log("Building images.");

const build = spawnSync(
  "bunx",
  [
    `varlock@${varlockVersion}`,
    "run",
    "--include-internal",
    "--",
    "sh",
    "-c",
    `${buildCommand}build`,
  ],
  { env: environment, stdio: "inherit" }
);
if (build.status !== 0) {
  console.error("Image build failed; deploy not attempted.");
  process.exit(build.status ?? 1);
}

const step = (label: string, args: string[]) => {
  const result = varlockRun(args);
  if (result.status !== 0) {
    console.error(`${label} failed.`);
    process.exit(result.status ?? 1);
  }
};

// The worker stops before the schema changes, and the API follows, so no writer
// is live while the one-shot migration runs.
step("Stopping the API and worker", ["docker", "compose", ...composeArgs, "stop", "api", "worker"]);
step("Starting the database", [
  "docker",
  "compose",
  ...composeArgs,
  "up",
  "--detach",
  "--wait",
  "database",
]);
step("Pre-migration invariant check", ["./scripts/auth-cleanup-inventory", "verify-final"]);
step("Applying migrations", ["docker", "compose", ...composeArgs, "run", "--rm", "migrate"]);
step("Post-migration invariant check", ["./scripts/auth-cleanup-inventory", "verify-final"]);
step("Starting the stack", [
  "docker",
  "compose",
  ...composeArgs,
  "up",
  "--detach",
  "--remove-orphans",
  "--wait",
]);

varlockRun(["docker", "compose", ...composeArgs, "ps"]);

step("Deployment smoke", ["./scripts/deployment-smoke"]);

// Deploy-time guard: name-diff what Docker actually baked into the containers
// against the schema's sensitivity split.
const verified = spawnSync("bun", ["scripts/verify-deployed-secrets.ts"], {
  env: environment,
  stdio: "inherit",
});
process.exit(verified.status ?? 1);
