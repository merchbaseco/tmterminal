import { expect, test } from "bun:test";

import { parseSyncOperationArguments } from "../../src/sync-ops.ts";

test("host sync operations reject unknown flags and extra positionals", () => {
  expect(() => parseSyncOperationArguments(["quarantine", "version", "--unknown", "reason"])).toThrow();
  expect(() => parseSyncOperationArguments(["replay-parser", "version", "extra"])).toThrow();
  expect(() => parseSyncOperationArguments(["full-rebuild", "--confirm-empty-target", "extra"])).toThrow();
});

test("host sync operations reject duplicate reasons and obsolete alert-ID arguments", () => {
  expect(() => parseSyncOperationArguments([
    "select-reissue", "version", "--reason", "first", "--reason", "second",
  ])).toThrow();
  expect(() => parseSyncOperationArguments([
    "recover-source-lane", "--alert-id", "alert-1", "--alert-id", "alert-1", "--reason", "inspected",
  ])).toThrow("Usage: sync:ops recover-source-lane");
});
