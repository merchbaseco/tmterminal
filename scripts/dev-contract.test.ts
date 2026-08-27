import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const productionDatabaseBinding =
  /"127\.0\.0\.1:\$\{TMTERMINAL_DATABASE_PUBLISHED_PORT:-5437\}:5432"/;
const sessionHookCommand = /^\$\{CLAUDE_PROJECT_DIR\}\/scripts\/claude-session-start$/;
const containerRuntimeCommand = /\bdocker\b|\bcompose\b/;
const sourcesAnEnvFile = /^\s*\.\s+.*\.env\b/m;
const testsForAnEnvFile = /-f\s+\.env\b/;
const hardCodedDatabasePassword = /TMTERMINAL_DB_PASSWORD=/;

test("the Codex setup resolves private-package credentials through the schema", async () => {
  const environment = await readFile(
    new URL("../.codex/environments/environment.toml", import.meta.url),
    "utf8"
  );

  expect(environment).toContain(
    "TMTERMINAL_RESOLVE_INSTALL_TOKENS=true bunx varlock printenv MERCHBASE_GITHUB_NPM_TOKEN"
  );
  // The install must be authenticated: the credentials are exported before it.
  const exportIndex = environment.indexOf(
    "export MERCHBASE_GITHUB_NPM_TOKEN MERCHBASE_HUGEICONS_LICENSE_KEY"
  );
  const installIndex = environment.indexOf("bun install --frozen-lockfile");
  expect(exportIndex).toBeGreaterThan(-1);
  expect(installIndex).toBeGreaterThan(exportIndex);
});

test("no venue copies or reads a plaintext env file", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  expect(gitignore).toContain("!.env.schema");
  expect(gitignore).not.toContain("!.env.example");

  const venuePaths = [
    "../.cursor/install.sh",
    "../.cursor/start.sh",
    "../scripts/dev",
    "../scripts/compose",
  ];
  const venues = await Promise.all(
    venuePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8"))
  );
  for (const contents of venues) {
    expect(contents).not.toMatch(sourcesAnEnvFile);
    expect(contents).not.toContain("--env-file");
  }
});

test("production publishes the development database port on loopback only", async () => {
  const compose = await readFile(new URL("../compose.yml", import.meta.url), "utf8");

  expect(compose).toMatch(productionDatabaseBinding);
  expect(compose).not.toContain('"5437:5432"');
});

test("containers receive resolved values and never resolve them", async () => {
  const compose = await readFile(new URL("../compose.yml", import.meta.url), "utf8");
  const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");

  // The root db:migrate wraps varlock for operators; the container must call the
  // workspace script directly, because the image carries no .env.schema.
  expect(compose).toContain('command: ["bun", "run", "--cwd", "apps/server", "db:migrate"]');
  expect(compose).not.toContain('command: ["bun", "run", "db:migrate"]');
  expect(dockerignore).toContain(".env.*");
});

test("development schema host is loopback", async () => {
  const schema = await readFile(new URL("../.env.schema", import.meta.url), "utf8");
  expect(schema).toContain(
    "TMTERMINAL_DATABASE_HOST=if(eq($VARLOCK_ENV, production), database, 127.0.0.1)"
  );
  expect(schema).not.toContain("zachs-mac-mini");
});

test("the Cursor cloud environment overrides the database host and the dev binds", async () => {
  const environment = JSON.parse(
    await readFile(new URL("../.cursor/environment.json", import.meta.url), "utf8")
  );
  expect(environment.name).toBe("Merchbase TMTerminal");

  const start = await readFile(new URL("../.cursor/start.sh", import.meta.url), "utf8");
  expect(start).toContain("export TMTERMINAL_DATABASE_HOST=127.0.0.1");
  expect(start).toContain("scripts/dev-db");

  // Cursor forwards the ports it can see, and it sees only non-loopback binds.
  const api = await readFile(new URL("../.cursor/api.sh", import.meta.url), "utf8");
  const web = await readFile(new URL("../.cursor/web.sh", import.meta.url), "utf8");
  expect(api).toContain("export TMTERMINAL_HOST=0.0.0.0");
  expect(web).toContain("export TMTERMINAL_DEV_HOST=0.0.0.0");
  expect(web).toContain("export VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN=true");

  // The seed's receipt is the boot's receipt; a discarded one leaves a session
  // with no evidence of what it is looking at.
  const devDb = await readFile(new URL("./dev-db", import.meta.url), "utf8");
  expect(devDb).toContain("bun run db:seed:dev");
  expect(devDb).not.toContain("db:seed:dev >/dev/null");
  expect(devDb).toContain("TMTERMINAL_DATABASE_HOST");

  // The cluster listens on the schema's development port, so the port is not
  // overridden anywhere; only the host is.
  const postgresLib = await readFile(
    new URL("../.cursor/postgres-lib.sh", import.meta.url),
    "utf8"
  );
  expect(postgresLib).toContain("PG_PORT=5437");
  expect(postgresLib).not.toMatch(hardCodedDatabasePassword);
});

test("development starts local API and web through varlock against loopback Postgres", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const developmentScript = await readFile(new URL("./dev", import.meta.url), "utf8");
  expect(developmentScript).not.toMatch(containerRuntimeCommand);
  expect(developmentScript).toContain('exec bunx varlock run -- "$0" "$@"');

  const root = await mkdtemp(join(tmpdir(), "tmterminal-dev-"));
  const bin = join(root, "bin");
  const log = join(root, "bun.log");
  const vitePid = join(root, "vite.pid");
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "apps/web/node_modules/.bin"), { recursive: true });
  await mkdir(join(root, "apps/docs/node_modules/.bin"), { recursive: true });
  await mkdir(bin);
  await copyFile(new URL("./dev", import.meta.url), join(root, "scripts", "dev"));
  await Bun.write(
    join(bin, "bun"),
    `#!/bin/sh
printf 'api|%s|%s|%s|%s|%s\n' \
  "$TMTERMINAL_DATABASE_URL" "$TMTERMINAL_PORT" "$TMTERMINAL_CLERK_AUTHORIZED_PARTIES" "$TMTERMINAL_HOST" "$*" \
  >> "$FAKE_BUN_LOG"
sleep 1
exit 7
`
  );
  await Bun.write(
    join(root, "apps/web/node_modules/.bin/vite"),
    `#!/bin/sh
printf 'web|%s|%s|%s\n' \
  "$VITE_MERCHBASE_CLERK_PUBLISHABLE_KEY" "$TMTERMINAL_API_PORT" "$*" \
  >> "$FAKE_BUN_LOG"
printf '%s\n' "$$" > "$FAKE_VITE_PID"
trap 'exit 0' TERM
while :; do :; done
`
  );
  await chmod(join(root, "scripts", "dev"), 0o755);
  await chmod(join(bin, "bun"), 0o755);
  await chmod(join(root, "apps/web/node_modules/.bin/vite"), 0o755);
  await Bun.write(
    join(root, "apps/docs/node_modules/.bin/vitepress"),
    `#!/bin/sh
printf 'docs|%s\\n' "$*" >> "$FAKE_BUN_LOG"
trap 'exit 0' TERM
while :; do :; done
`
  );
  await chmod(join(root, "apps/docs/node_modules/.bin/vitepress"), 0o755);

  // The re-exec under `varlock run` has already happened at this point, so the
  // resolved environment is supplied directly — the same seam varlock fills.
  const process = Bun.spawn(["/bin/sh", join(root, "scripts", "dev")], {
    env: {
      FAKE_BUN_LOG: log,
      FAKE_VITE_PID: vitePid,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      TMTERMINAL_API_PORT: "4101",
      TMTERMINAL_CLERK_AUTHORIZED_PARTIES: "http://127.0.0.1:4100",
      TMTERMINAL_DATABASE_URL: "postgres://tmturtle:secret@127.0.0.1:5437/tmturtle",
      TMTERMINAL_DEV_ENV_READY: "1",
      TMTERMINAL_HOST: "127.0.0.1",
      TMTERMINAL_PORT: "4101",
      TMTERMINAL_WEB_PORT: "4100",
      VITE_MERCHBASE_CLERK_PUBLISHABLE_KEY: "pk_test_tmterminal",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  try {
    expect(await process.exited).toBe(7);
    expect(await new Response(process.stdout).text()).toContain(
      "Local development database on 127.0.0.1. Seed is fabricated. Worker is off."
    );
    expect(packageJson.scripts.dev).toBe("./scripts/dev");
    const calls = (await Bun.file(log).text()).trim().split("\n");
    expect(calls).toHaveLength(3);
    expect(calls).toContainEqual(
      expect.stringContaining(
        "api|postgres://tmturtle:secret@127.0.0.1:5437/tmturtle|4101|http://127.0.0.1:4100|127.0.0.1|apps/server/src/server.ts"
      )
    );
    // The bind address is the Vite config's to decide from TMTERMINAL_DEV_HOST,
    // so the command line carries only the port.
    expect(calls).toContain("web|pk_test_tmterminal|4101|apps/web --port 4100");
    expect(calls).toContain("docs|dev apps/docs --port 5174 --host 127.0.0.1");
    expect(calls.join("\n")).not.toContain("worker");
    expect(calls.join("\n")).not.toContain("migrate");
    const stoppedVitePid = (await Bun.file(vitePid).text()).trim();
    expect(
      Bun.spawnSync(["/bin/kill", "-0", stoppedVitePid], { stderr: "ignore" }).exitCode
    ).not.toBe(0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function runSessionStart(installed: boolean) {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-session-"));
  const bin = join(root, "bin");
  const log = join(root, "install.log");
  await mkdir(join(root, "scripts"));
  await mkdir(bin);
  await copyFile(
    new URL("./claude-session-start", import.meta.url),
    join(root, "scripts", "claude-session-start")
  );
  // The hook sources the shared install-token helper, so the fixture mirrors
  // the real script layout.
  await copyFile(
    new URL("./install-tokens", import.meta.url),
    join(root, "scripts", "install-tokens")
  );
  await chmod(join(root, "scripts", "claude-session-start"), 0o755);

  if (installed) {
    await mkdir(join(root, "apps/web/node_modules/.bin"), { recursive: true });
    await Bun.write(join(root, "apps/web/node_modules/.bin/vite"), "#!/bin/sh\n");
    await chmod(join(root, "apps/web/node_modules/.bin/vite"), 0o755);
  }

  await Bun.write(
    join(bin, "bun"),
    `#!/bin/sh
if test -n "\${MERCHBASE_GITHUB_NPM_TOKEN:-}"; then
  printf 'authenticated|%s\\n' "$*" >> "$FAKE_INSTALL_LOG"
else
  printf 'missing-auth|%s\\n' "$*" >> "$FAKE_INSTALL_LOG"
fi
`
  );
  // The install credentials are @internal, so they are fetched with
  // `varlock printenv` under the install switch rather than exported by
  // `varlock run`.
  await Bun.write(
    join(bin, "bunx"),
    `#!/bin/sh
test "$1" = "varlock"
test "$2" = "printenv"
test -n "\${TMTERMINAL_RESOLVE_INSTALL_TOKENS:-}"
printf 'resolved-%s\\n' "$3"
`
  );
  await Bun.write(
    join(bin, "dev-port"),
    `#!/bin/sh
mkdir -p .claude
printf '{"version":"0.0.1","configurations":[{"name":"%s","runtimeExecutable":"%s","runtimeArgs":[],"port":4100}]}\\n' \\
  "$2" "$3" > .claude/launch.json
`
  );
  await chmod(join(bin, "bun"), 0o755);
  await chmod(join(bin, "bunx"), 0o755);
  await chmod(join(bin, "dev-port"), 0o755);

  const process = Bun.spawn(["/bin/sh", join(root, "scripts", "claude-session-start")], {
    env: {
      FAKE_INSTALL_LOG: log,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const exitCode = await process.exited;
  const launch = JSON.parse(await Bun.file(join(root, ".claude/launch.json")).text());
  const installs = (await Bun.file(log).exists())
    ? (await Bun.file(log).text()).trim().split("\n").filter(Boolean)
    : [];
  await rm(root, { force: true, recursive: true });
  return { exitCode, installs, launch };
}

test("the session hook prepares a fresh checkout for the dev preview", async () => {
  const settings = JSON.parse(
    await readFile(new URL("../.claude/settings.json", import.meta.url), "utf8")
  );
  expect(settings.hooks.SessionStart[0].hooks[0].command).toMatch(sessionHookCommand);

  const hook = await readFile(new URL("./claude-session-start", import.meta.url), "utf8");
  expect(hook).not.toContain("gh auth token");
  // No plaintext env step: the hook neither reads nor asks for a .env file.
  expect(hook).not.toContain("Missing .env");
  expect(hook).not.toMatch(testsForAnEnvFile);
  expect(hook).not.toMatch(sourcesAnEnvFile);

  const { exitCode, installs, launch } = await runSessionStart(false);

  expect(exitCode).toBe(0);
  expect(installs).toEqual(["authenticated|install --frozen-lockfile"]);
  expect(launch.configurations).toEqual([
    { name: "dev", port: 4100, runtimeArgs: [], runtimeExecutable: "./scripts/dev" },
  ]);
});

test("the session hook reuses installed dependencies", async () => {
  const { exitCode, installs, launch } = await runSessionStart(true);

  expect(exitCode).toBe(0);
  expect(installs).toEqual([]);
  expect(launch.configurations[0].runtimeExecutable).toBe("./scripts/dev");
});
