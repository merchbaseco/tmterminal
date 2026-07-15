import { expect, test } from "bun:test";

import { isWorkerReady } from "../../src/worker-readiness.ts";

test("worker readiness accepts persisted provider backoff", () => {
  expect(isWorkerReady("backoff")).toBe(true);
});

test.each(["failed", "operator-action-required", "stopped"] as const)(
  "worker readiness rejects %s sync state",
  (state) => expect(isWorkerReady(state)).toBe(false),
);
