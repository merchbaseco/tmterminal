import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const productionDatabaseBinding = /"127\.0\.0\.1:\$\{TMTURTLE_DATABASE_PORT:-5437\}:5432"/;
const sessionHookCommand = /^\$\{CLAUDE_PROJECT_DIR\}\/scripts\/claude-session-start$/;
const containerRuntimeCommand = /\bdocker\b|\bcompose\b/;

test("production publishes the development database port on loopback only", async () => {
  const compose = await readFile(new URL("../compose.yml", import.meta.url), "utf8");

  expect(compose).toMatch(productionDatabaseBinding);
  expect(compose).not.toContain('"5437:5432"');
});

test("development starts local API and web against the Mac mini database", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const developmentScript = await readFile(new URL("./dev", import.meta.url), "utf8");
  expect(developmentScript).not.toMatch(containerRuntimeCommand);

  const root = await mkdtemp(join(tmpdir(), "tmturtle-dev-"));
  const bin = join(root, "bin");
  const log = join(root, "bun.log");
  const vitePid = join(root, "vite.pid");
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "apps/web/node_modules/.bin"), { recursive: true });
  await mkdir(bin);
  await copyFile(new URL("./dev", import.meta.url), join(root, "scripts", "dev"));
  await Bun.write(
    join(root, ".env"),
    [
      "DATABASE_URL=postgres://tmturtle:secret@database:5432/tmturtle",
      "CLERK_SECRET_KEY=test-secret",
      "VITE_CLERK_PUBLISHABLE_KEY=test-publishable-key",
    ].join("\n")
  );
  await Bun.write(
    join(bin, "dev-port"),
    `#!/bin/sh
case "$1" in
  0) printf '4100\\n' ;;
  1) printf '4101\\n' ;;
  *) exit 1 ;;
esac
`
  );
  await Bun.write(
    join(bin, "bun"),
    `#!/bin/sh
printf 'api|%s|%s|%s|%s|%s\n' \
  "$DATABASE_URL" "$PORT" "$CLERK_AUTHORIZED_PARTIES" "$HOST" "$*" \
  >> "$FAKE_BUN_LOG"
sleep 1
exit 7
`
  );
  await Bun.write(
    join(root, "apps/web/node_modules/.bin/vite"),
    `#!/bin/sh
printf 'web|%s|%s|%s|%s\n' \
  "$DATABASE_URL" "$CLERK_AUTHORIZED_PARTIES" "$TMTURTLE_API_PORT" "$*" \
  >> "$FAKE_BUN_LOG"
printf '%s\n' "$$" > "$FAKE_VITE_PID"
trap 'exit 0' TERM
while :; do :; done
`
  );
  await chmod(join(root, "scripts", "dev"), 0o755);
  await chmod(join(bin, "dev-port"), 0o755);
  await chmod(join(bin, "bun"), 0o755);
  await chmod(join(root, "apps/web/node_modules/.bin/vite"), 0o755);

  const process = Bun.spawn(["/bin/sh", join(root, "scripts", "dev")], {
    env: {
      FAKE_BUN_LOG: log,
      FAKE_VITE_PID: vitePid,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  try {
    expect(await process.exited).toBe(7);
    expect(await new Response(process.stdout).text()).toContain(
      "Using the production database; mutations are real."
    );
    expect(packageJson.scripts.dev).toBe("./scripts/dev");
    const calls = (await Bun.file(log).text()).trim().split("\n");
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual(
      expect.stringContaining(
        "api|postgres://tmturtle:secret@zachs-mac-mini.taila0b849.ts.net:5437/tmturtle|4101|http://127.0.0.1:4100|127.0.0.1|apps/server/src/server.ts"
      )
    );
    expect(calls).toContain(
      "web|postgres://tmturtle:secret@zachs-mac-mini.taila0b849.ts.net:5437/tmturtle|http://127.0.0.1:4100|4101|apps/web --host 127.0.0.1 --port 4100"
    );
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
  const root = await mkdtemp(join(tmpdir(), "tmturtle-session-"));
  const bin = join(root, "bin");
  const log = join(root, "install.log");
  await mkdir(join(root, "scripts"));
  await mkdir(bin);
  await copyFile(
    new URL("./claude-session-start", import.meta.url),
    join(root, "scripts", "claude-session-start")
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
printf '%s\\n' "$*" >> "$FAKE_INSTALL_LOG"
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
  const stdout = await new Response(process.stdout).text();
  const launch = JSON.parse(await Bun.file(join(root, ".claude/launch.json")).text());
  const installs = (await Bun.file(log).exists())
    ? (await Bun.file(log).text()).trim().split("\n").filter(Boolean)
    : [];
  await rm(root, { force: true, recursive: true });
  return { exitCode, installs, launch, stdout };
}

test("the session hook prepares a fresh checkout for the dev preview", async () => {
  const settings = JSON.parse(
    await readFile(new URL("../.claude/settings.json", import.meta.url), "utf8")
  );
  expect(settings.hooks.SessionStart[0].hooks[0].command).toMatch(sessionHookCommand);

  const { exitCode, installs, launch, stdout } = await runSessionStart(false);

  expect(exitCode).toBe(0);
  expect(installs).toEqual(["install --frozen-lockfile"]);
  expect(stdout).toContain("Missing .env");
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
