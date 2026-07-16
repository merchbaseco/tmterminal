import { expect, test } from "bun:test";

import { parseSyncOperationArguments } from "../../src/sync-ops.ts";

test("host sync operations reject unknown flags and extra positionals", () => {
  expect(() =>
    parseSyncOperationArguments(["quarantine", "version", "--unknown", "reason"])
  ).toThrow();
  expect(() =>
    parseSyncOperationArguments(["full-rebuild", "--confirm-offline-rebuild", "extra"])
  ).toThrow();
  expect(() => parseSyncOperationArguments(["full-rebuild", "--confirm-empty-target"])).toThrow();
});

test("full rebuild requires the explicit offline cutover confirmation", () => {
  expect(parseSyncOperationArguments(["full-rebuild", "--confirm-offline-rebuild"])).toEqual({
    command: "full-rebuild",
  });
});

test("artifact reprocessing requires one exact version and a nonempty reason", () => {
  expect(
    parseSyncOperationArguments([
      "reprocess-artifact",
      "10000000-0000-4000-8000-000000000001",
      "--reason",
      "Reparse with parser v4",
    ])
  ).toEqual({
    command: "reprocess-artifact",
    identifier: "10000000-0000-4000-8000-000000000001",
    reason: "Reparse with parser v4",
  });
  expect(() =>
    parseSyncOperationArguments([
      "reprocess-artifact",
      "10000000-0000-4000-8000-000000000001",
      "--reason",
      " ",
    ])
  ).toThrow("Usage: sync:ops reprocess-artifact");
  expect(() =>
    parseSyncOperationArguments([
      "reprocess-artifact",
      "10000000-0000-4000-8000-000000000001",
      "--reason",
      "Reparse with parser v4",
      "extra",
    ])
  ).toThrow("Usage: sync:ops reprocess-artifact");
});

test("host sync operations reject duplicate reasons and obsolete alert-ID arguments", () => {
  expect(() =>
    parseSyncOperationArguments([
      "select-reissue",
      "version",
      "--reason",
      "first",
      "--reason",
      "second",
    ])
  ).toThrow();
  expect(() =>
    parseSyncOperationArguments([
      "recover-source-lane",
      "--alert-id",
      "alert-1",
      "--alert-id",
      "alert-1",
      "--reason",
      "inspected",
    ])
  ).toThrow("Usage: sync:ops recover-source-lane");
});
