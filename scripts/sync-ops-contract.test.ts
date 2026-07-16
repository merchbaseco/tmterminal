import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("host sync commands preserve worktree Compose isolation", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const rebuild = await readFile(new URL("./full-rebuild", import.meta.url), "utf8");

  expect(packageJson.scripts["sync:ops"]).toStartWith("./scripts/compose exec worker");
  expect(rebuild).toContain("./scripts/compose stop worker");
  expect(rebuild).toContain("TMTURTLE_OFFLINE_REBUILD=1");
  expect(rebuild).toContain("full-rebuild --confirm-offline-rebuild");
  expect(rebuild).toContain("./scripts/compose run --rm --no-deps");
  expect(rebuild).not.toContain("start worker");
  expect(rebuild).not.toContain("restart_worker");
  expect(rebuild).not.toContain("docker compose");
});

test("premerge cutover SHA mismatch prevents every Compose invocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmturtle-premerge-cutover-"));
  const mainCheckout = join(root, "main");
  const candidateCheckout = `${mainCheckout}-prd77-cutover`;
  const bin = join(root, "bin");
  const composeLog = join(root, "compose.log");
  const masterEnv = join(root, "master.env");
  await mkdir(join(mainCheckout, "scripts"), { recursive: true });
  await mkdir(bin);
  await Bun.write(masterEnv, "DATABASE_URL=redacted\n");
  await copyFile(
    new URL("./prd77-premerge-cutover", import.meta.url),
    join(mainCheckout, "scripts", "prd77-premerge-cutover")
  );
  await Bun.write(
    join(bin, "git"),
    `#!/bin/sh
set -eu
if [ "$3" = worktree ]; then
  mkdir -p "$6/scripts"
  printf '#!/bin/sh\nprintf compose >> "$FAKE_COMPOSE_LOG"\n' > "$6/scripts/compose"
  printf '#!/bin/sh\nprintf rebuild >> "$FAKE_COMPOSE_LOG"\n' > "$6/scripts/full-rebuild"
  chmod +x "$6/scripts/compose" "$6/scripts/full-rebuild"
elif [ "$3" = rev-parse ]; then
  printf '%s\n' '0000000000000000000000000000000000000000'
fi
`
  );
  await chmod(join(bin, "git"), 0o755);
  await chmod(join(mainCheckout, "scripts", "prd77-premerge-cutover"), 0o755);

  const candidateSha = "1234567890abcdef1234567890abcdef12345678";
  const process = Bun.spawn(
    [
      "/bin/sh",
      join(mainCheckout, "scripts", "prd77-premerge-cutover"),
      candidateSha,
      mainCheckout,
      masterEnv,
    ],
    {
      env: {
        ...globalThis.process.env,
        FAKE_COMPOSE_LOG: composeLog,
        PATH: `${bin}:${globalThis.process.env.PATH}`,
      },
      stderr: "pipe",
      stdout: "pipe",
    }
  );

  try {
    expect(await process.exited).not.toBe(0);
    expect(await Bun.file(join(candidateCheckout, "scripts", "compose")).exists()).toBe(true);
    expect(await Bun.file(composeLog).exists()).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`full rebuild ${signal} exits and leaves the worker stopped`, async () => {
    const root = await mkdtemp(join(tmpdir(), "tmturtle-full-rebuild-"));
    const scripts = join(root, "scripts");
    const log = join(root, "compose.log");
    const ready = join(root, "run.ready");
    await mkdir(scripts);
    await copyFile(new URL("./full-rebuild", import.meta.url), join(scripts, "full-rebuild"));
    await Bun.write(
      join(scripts, "compose"),
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_COMPOSE_LOG"
if [ "$1" = run ]; then
  : > "$FAKE_COMPOSE_READY"
  trap 'exit 130' INT
  trap 'exit 143' TERM
  while :; do sleep 1; done
fi
`
    );
    await chmod(join(scripts, "full-rebuild"), 0o755);
    await chmod(join(scripts, "compose"), 0o755);
    const process = Bun.spawn(["/bin/sh", join(scripts, "full-rebuild")], {
      cwd: root,
      detached: true,
      env: { ...globalThis.process.env, FAKE_COMPOSE_LOG: log, FAKE_COMPOSE_READY: ready },
      stderr: "pipe",
      stdout: "pipe",
    });

    try {
      // biome-ignore lint/performance/noAwaitInLoops: Shell-fixture readiness polling is intentionally sequential.
      for (let attempt = 0; attempt < 100 && !(await Bun.file(ready).exists()); attempt += 1) {
        await Bun.sleep(10);
      }
      expect(await Bun.file(ready).exists()).toBe(true);
      globalThis.process.kill(-process.pid, signal);
      expect(await process.exited).toBe(exitCode);
      const calls = (await Bun.file(log).text()).trim().split("\n");
      expect(calls).not.toContain("start worker");
      expect(calls.at(0)).toBe("stop worker");
    } finally {
      if (process.exitCode === null) {
        process.kill("SIGKILL");
      }
      await rm(root, { force: true, recursive: true });
    }
  });
}
