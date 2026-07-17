import { expect, test } from "bun:test";

import type { AnnualCorpusStatus } from "../../src/ingestion/annual-corpus.ts";
import { syncStatusFromFacts } from "../../src/services/sync-service.ts";

const healthy: AnnualCorpusStatus = {
  activeGenerationId: "70000000-0000-4000-8000-000000000001",
  completeArtifactCount: 91,
  completeThroughDate: "2099-01-01",
  corpusVersion: 1,
  currentArtifact: null,
  expectedArtifactCount: 91,
  failedArtifactCount: 0,
  failedArtifactUpdatedAt: null,
  lane: {
    currentError: null,
    failureCount: 0,
    nextEligibleAt: null,
    status: "ready",
    updatedAt: new Date("2026-01-03T00:00:00Z"),
  },
  lastSuccessfulMergeAt: new Date("2026-01-01T00:00:00Z"),
  pendingArtifactCount: 0,
  projectedMarkCount: 1,
  publishedThroughDate: "2099-01-01",
};

test("healthy status has no future degradation timestamp", () => {
  expect(syncStatusFromFacts(healthy)).toMatchObject({
    degraded: false,
    degradedSince: null,
    rejectCount: 0,
    stale: false,
    staleSince: null,
  });
});

test("staleness begins at the public stale threshold", () => {
  expect(syncStatusFromFacts({ ...healthy, completeThroughDate: "2000-01-01" })).toMatchObject({
    degraded: true,
    degradedSince: "2000-01-05T00:00:00.000Z",
    stale: true,
    staleSince: "2000-01-05T00:00:00.000Z",
  });
});

test("artifact failure uses its own timestamp without creating rejects", () => {
  expect(
    syncStatusFromFacts({
      ...healthy,
      failedArtifactCount: 1,
      failedArtifactUpdatedAt: new Date("2026-01-02T00:00:00Z"),
    })
  ).toMatchObject({
    activeState: "failed",
    degraded: true,
    degradedSince: "2026-01-02T00:00:00.000Z",
    failedCount: 1,
    rejectCount: 0,
  });
});

test("provider backoff and stop use the lane transition timestamp", () => {
  const updatedAt = new Date("2026-01-03T00:00:00Z");
  expect(
    syncStatusFromFacts({ ...healthy, lane: { ...healthy.lane, status: "backoff", updatedAt } })
  ).toMatchObject({
    activeState: "backoff",
    degraded: true,
    degradedSince: updatedAt.toISOString(),
    failedCount: 0,
  });
  expect(
    syncStatusFromFacts({ ...healthy, lane: { ...healthy.lane, status: "stopped", updatedAt } })
  ).toMatchObject({
    activeState: "stopped",
    degraded: true,
    degradedSince: updatedAt.toISOString(),
    failedCount: 1,
  });
});
