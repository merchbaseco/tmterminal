import { expect, test } from "bun:test";

import type { TrademarkIngestionStatus } from "../../src/ingestion/trademark-ingestion.ts";
import { syncStatusFromFacts } from "../../src/services/sync-service.ts";
import { isWorkerReady } from "../../src/worker-readiness.ts";

const healthy: TrademarkIngestionStatus = {
  annualCompleteArtifactCount: 91,
  annualProjectedMarkCount: 1,
  completeThroughDate: "2099-01-01",
  currentArtifact: null,
  dataVersion: 1,
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
  lastSuccessfulUpdateAt: new Date("2026-01-01T00:00:00Z"),
  pendingArtifactCount: 0,
  unavailableArtifactCount: 0,
};

test("healthy status has no future degradation timestamp", () => {
  expect(syncStatusFromFacts(healthy)).toMatchObject({
    degraded: false,
    degradedSince: null,
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

test("artifact failure uses its own timestamp", () => {
  const status = syncStatusFromFacts({
    ...healthy,
    failedArtifactCount: 1,
    failedArtifactUpdatedAt: new Date("2026-01-02T00:00:00Z"),
    pendingArtifactCount: 1,
  });
  expect(status).toMatchObject({
    activeState: "failed",
    degraded: true,
    degradedSince: "2026-01-02T00:00:00.000Z",
    failedCount: 1,
    pendingCount: 1,
  });
  expect(isWorkerReady(status.activeState)).toBe(true);
});

test("provider backoff and stop use the lane transition timestamp", () => {
  const updatedAt = new Date("2026-01-03T00:00:00Z");
  expect(
    syncStatusFromFacts({ ...healthy, lane: { ...healthy.lane, status: "backoff", updatedAt } })
  ).toMatchObject({
    activeState: "backoff",
    degraded: true,
    degradedSince: updatedAt.toISOString(),
  });
  expect(
    syncStatusFromFacts({
      ...healthy,
      failedArtifactCount: 1,
      failedArtifactUpdatedAt: new Date("2026-01-02T00:00:00Z"),
      lane: { ...healthy.lane, status: "stopped", updatedAt },
    })
  ).toMatchObject({
    activeState: "stopped",
    degraded: true,
    degradedSince: "2026-01-02T00:00:00.000Z",
  });
  expect(isWorkerReady("stopped")).toBe(false);
});
