import { expect, test } from "bun:test";

import { isWorkerReady } from "../../src/worker-readiness.ts";

test("worker readiness accepts persisted provider backoff", () => {
  expect(isWorkerReady("backoff")).toBe(true);
});

test("worker readiness accepts an isolated artifact failure", () => {
  expect(isWorkerReady("failed")).toBe(true);
});

test("worker readiness rejects a stopped provider lane", () => {
  expect(isWorkerReady("stopped")).toBe(false);
});
