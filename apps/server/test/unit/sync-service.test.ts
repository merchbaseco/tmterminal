import { expect, test } from "bun:test";

import type { TrademarkIngestionStatus } from "../../src/ingestion/trademark-ingestion.ts";
import { syncStatusFromFacts } from "../../src/services/sync-service.ts";

const healthy: TrademarkIngestionStatus = {
  attentionCount: 0,
  currentArtifact: null,
  dataVersion: 1,
  lastSuccessfulUpdateAt: new Date("2026-01-01T00:00:00Z"),
  latestProcessedDate: "2026-01-01",
  pendingArtifactCount: 0,
  worker: {
    activity: "idle",
    currentError: null,
    lastDiscoveryAt: new Date("2026-01-01T00:00:00Z"),
    lastHeartbeatAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  },
};
const now = new Date("2026-01-01T00:01:00Z");

test("reports the perpetual live database without a corpus frontier", () => {
  expect(syncStatusFromFacts(healthy, now)).toEqual({
    activeState: "idle",
    dataVersion: 1,
    failedCount: 0,
    lastSuccessfulUpdateAt: "2026-01-01T00:00:00.000Z",
    latestProcessedDate: "2026-01-01",
    pendingCount: 0,
  });
});

test("source issues do not make the worker or searchable data unavailable", () => {
  expect(
    syncStatusFromFacts({ ...healthy, attentionCount: 2, pendingArtifactCount: 3 }, now)
  ).toMatchObject({ activeState: "idle", failedCount: 2, pendingCount: 3 });
});

test("a system worker error fails readiness independently of source issues", () => {
  expect(
    syncStatusFromFacts(
      {
        ...healthy,
        worker: { ...healthy.worker, currentError: "database unavailable" },
      },
      now
    )
  ).toMatchObject({ activeState: "failed", failedCount: 1 });
});

test("a stale worker heartbeat fails safe status", () => {
  expect(
    syncStatusFromFacts(
      {
        ...healthy,
        worker: {
          ...healthy.worker,
          activity: "applying",
          lastHeartbeatAt: new Date("2025-12-31T23:55:59Z"),
        },
      },
      now
    )
  ).toMatchObject({ activeState: "failed", failedCount: 1 });
});

test("a new worker gets five minutes to emit its first heartbeat", () => {
  expect(
    syncStatusFromFacts(
      {
        ...healthy,
        worker: { ...healthy.worker, lastHeartbeatAt: null, updatedAt: now },
      },
      now
    )
  ).toMatchObject({ activeState: "idle", failedCount: 0 });
  expect(
    syncStatusFromFacts(
      {
        ...healthy,
        worker: {
          ...healthy.worker,
          lastHeartbeatAt: null,
          updatedAt: new Date("2025-12-31T23:54:59Z"),
        },
      },
      now
    )
  ).toMatchObject({ activeState: "failed", failedCount: 1 });
});
