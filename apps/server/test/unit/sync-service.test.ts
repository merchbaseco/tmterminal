import { expect, test } from "bun:test";

import type { SyncFacts } from "../../src/queries/sync-repository.ts";
import { syncStatusFromFacts } from "../../src/services/sync-service.ts";

const current: SyncFacts = {
  activeAttemptKind: null,
  activeAttemptStartedAt: null,
  completeThroughDate: "2026-07-15",
  corpusVersion: 1,
  currentDate: "2026-07-15",
  failedCount: 0,
  failedSince: null,
  hasParseTarget: false,
  hasPublicationTarget: false,
  lastSuccessfulMergeAt: new Date("2026-07-15T12:00:00Z"),
  laneNextEligibleAt: null,
  laneStatus: "ready",
  laneUpdatedAt: new Date("2026-07-15T12:00:00Z"),
  pendingCount: 0,
  publishedThroughDate: "2026-07-15",
  quarantineCount: 0,
  reconcileActiveSince: null,
  reconcileFailedSince: null,
  reconcileFailureMessage: null,
  rejectCount: 0,
  rejectedSince: null,
  reissueSelectionRequiredCount: 0,
  reissueSelectionRequiredSince: null,
};

test("active publication remains publishing with unrelated pending work", () => {
  expect(syncStatusFromFacts({
    ...current,
    pendingCount: 1,
    hasPublicationTarget: true,
    reconcileActiveSince: new Date("2026-07-15T13:00:00Z"),
  }).activeState).toBe("publishing");
});

test("pending download is not parsing before a source attempt starts", () => {
  expect(syncStatusFromFacts({ ...current, pendingCount: 1 }).activeState).toBe("idle");
});

test("active publication wins while the source lane remains in backoff", () => {
  expect(syncStatusFromFacts({
    ...current,
    laneStatus: "backoff",
    pendingCount: 1,
    hasPublicationTarget: true,
    reconcileActiveSince: new Date("2026-07-15T13:00:00Z"),
  })).toMatchObject({ activeState: "publishing", degraded: true });
});

test("active recovery parse wins over the preceding failed delivery", () => {
  expect(syncStatusFromFacts({
    ...current,
    hasParseTarget: true,
    reconcileActiveSince: new Date("2026-07-15T13:00:00Z"),
    reconcileFailedSince: new Date("2026-07-15T12:30:00Z"),
    reconcileFailureMessage: "previous delivery failed",
  })).toMatchObject({ activeState: "parsing", degraded: true, failedCount: 1 });
});
