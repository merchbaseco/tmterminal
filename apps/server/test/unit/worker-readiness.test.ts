import { expect, test } from "bun:test";

import { isWorkerReady } from "../../src/worker-readiness.ts";

test("worker readiness accepts ordinary ingestion activity", () => {
  expect(isWorkerReady("idle", true)).toBe(true);
  expect(isWorkerReady("discovering", true)).toBe(true);
  expect(isWorkerReady("downloading", true)).toBe(true);
  expect(isWorkerReady("applying", true)).toBe(true);
});

test("worker readiness rejects a system failure", () => {
  expect(isWorkerReady("failed", true)).toBe(false);
});

test("worker readiness waits for the first reconciliation", () => {
  expect(isWorkerReady("idle", false)).toBe(false);
  expect(isWorkerReady("discovering", false)).toBe(false);
});
