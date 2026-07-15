import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("host sync commands preserve worktree Compose isolation", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const rebuild = await readFile(new URL("./full-rebuild", import.meta.url), "utf8");

  expect(packageJson.scripts["sync:ops"]).toStartWith("./scripts/compose exec worker");
  expect(rebuild).toContain("./scripts/compose stop worker");
  expect(rebuild).toContain("TMTURTLE_OFFLINE_REBUILD=1");
  expect(rebuild).toContain("./scripts/compose run --rm --no-deps");
  expect(rebuild).toContain("./scripts/compose start worker");
  expect(rebuild).toContain("trap restart_worker EXIT");
  expect(rebuild).toContain("trap 'exit 130' INT");
  expect(rebuild).toContain("trap 'exit 143' TERM");
  expect(rebuild).not.toContain("trap restart_worker EXIT INT TERM");
  expect(rebuild).not.toContain("docker compose");
});

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  test(`full rebuild ${signal} exits and restarts the worker exactly once`, async () => {
    const root = await mkdtemp(join(tmpdir(), "tmturtle-full-rebuild-"));
    const scripts = join(root, "scripts");
    const log = join(root, "compose.log");
    const ready = join(root, "run.ready");
    await mkdir(scripts);
    await copyFile(new URL("./full-rebuild", import.meta.url), join(scripts, "full-rebuild"));
    await Bun.write(join(scripts, "compose"), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_COMPOSE_LOG"
if [ "$1" = run ]; then
  : > "$FAKE_COMPOSE_READY"
  trap 'exit 130' INT
  trap 'exit 143' TERM
  while :; do sleep 1; done
fi
`);
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
      for (let attempt = 0; attempt < 100 && !(await Bun.file(ready).exists()); attempt += 1) {
        await Bun.sleep(10);
      }
      expect(await Bun.file(ready).exists()).toBe(true);
      globalThis.process.kill(-process.pid, signal);
      expect(await process.exited).toBe(exitCode);
      const calls = (await Bun.file(log).text()).trim().split("\n");
      expect(calls.filter((call) => call === "start worker")).toHaveLength(1);
      expect(calls.at(-1)).toBe("start worker");
    } finally {
      if (process.exitCode === null) globalThis.process.kill(-process.pid, "SIGKILL");
      await rm(root, { force: true, recursive: true });
    }
  });
}
