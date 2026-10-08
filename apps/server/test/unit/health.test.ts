import { describe, expect, test } from "bun:test";

import { classifyWorkerError } from "../../src/ingestion/trademark-ingestion.ts";
import { type HealthRead, judgeHealth } from "../../src/services/health.ts";

const observedAt = new Date("2026-06-01T12:00:00.000Z");
const fiveMinutesMs = 5 * 60 * 1000;
const ninetySixHoursMs = 96 * 60 * 60 * 1000;

function readable(
  overrides: Partial<Extract<HealthRead, { kind: "read" }>> = {}
): Extract<HealthRead, { kind: "read" }> {
  return {
    kind: "read",
    lastSuccessfulUpdateAt: observedAt,
    observedAt,
    workerError: "none",
    workerHeartbeatAt: observedAt,
    ...overrides,
  };
}

describe("judgeHealth", () => {
  test("fresh heartbeat, no error, and fresh data are ok", () => {
    const report = judgeHealth(readable());
    expect(report).toEqual({ status: "ok" });
    expect(JSON.stringify(report)).toBe('{"status":"ok"}');
  });

  test("an unreadable database fails database", () => {
    expect(judgeHealth({ kind: "unreadable" })).toEqual({
      failing: ["database"],
      status: "degraded",
    });
  });

  test("a null heartbeat fails worker", () => {
    expect(judgeHealth(readable({ workerHeartbeatAt: null }))).toEqual({
      failing: ["worker"],
      status: "degraded",
    });
  });

  test("a heartbeat exactly 5 minutes old is ok", () => {
    expect(
      judgeHealth(readable({ workerHeartbeatAt: new Date(observedAt.getTime() - fiveMinutesMs) }))
    ).toEqual({ status: "ok" });
  });

  test("a heartbeat 5 minutes and 1 ms old fails worker", () => {
    expect(
      judgeHealth(
        readable({ workerHeartbeatAt: new Date(observedAt.getTime() - fiveMinutesMs - 1) })
      )
    ).toEqual({ failing: ["worker"], status: "degraded" });
  });

  test("a heartbeat 30 seconds ahead of observedAt is ok", () => {
    expect(
      judgeHealth(readable({ workerHeartbeatAt: new Date(observedAt.getTime() + 30_000) }))
    ).toEqual({ status: "ok" });
  });

  test("discovery backoff with a fresh heartbeat and fresh data is ok", () => {
    expect(judgeHealth(readable({ workerError: "discovery_backoff" }))).toEqual({ status: "ok" });
  });

  test("discovery backoff with a stale heartbeat fails worker", () => {
    expect(
      judgeHealth(
        readable({
          workerError: "discovery_backoff",
          workerHeartbeatAt: new Date(observedAt.getTime() - fiveMinutesMs - 1),
        })
      )
    ).toEqual({ failing: ["worker"], status: "degraded" });
  });

  test("a stopped worker with a fresh heartbeat fails worker", () => {
    expect(judgeHealth(readable({ workerError: "stopped" }))).toEqual({
      failing: ["worker"],
      status: "degraded",
    });
  });

  test("a null successful update fails uspto_data", () => {
    expect(judgeHealth(readable({ lastSuccessfulUpdateAt: null }))).toEqual({
      failing: ["uspto_data"],
      status: "degraded",
    });
  });

  test("data exactly 96 hours old is ok", () => {
    expect(
      judgeHealth(
        readable({
          lastSuccessfulUpdateAt: new Date(observedAt.getTime() - ninetySixHoursMs),
        })
      )
    ).toEqual({ status: "ok" });
  });

  test("data 96 hours and 1 ms old fails uspto_data", () => {
    expect(
      judgeHealth(
        readable({
          lastSuccessfulUpdateAt: new Date(observedAt.getTime() - ninetySixHoursMs - 1),
        })
      )
    ).toEqual({ failing: ["uspto_data"], status: "degraded" });
  });

  test("a stale heartbeat and stale data fail worker then uspto_data", () => {
    const report = judgeHealth(
      readable({
        lastSuccessfulUpdateAt: new Date(observedAt.getTime() - ninetySixHoursMs - 1),
        workerHeartbeatAt: new Date(observedAt.getTime() - fiveMinutesMs - 1),
      })
    );
    expect(report).toEqual({ failing: ["worker", "uspto_data"], status: "degraded" });
    expect(JSON.stringify(report)).toBe('{"status":"degraded","failing":["worker","uspto_data"]}');
  });
});

describe("classifyWorkerError", () => {
  test("null is none", () => {
    expect(classifyWorkerError(null)).toBe("none");
  });

  test("a discovery backoff prefix is discovery_backoff", () => {
    expect(classifyWorkerError("Discovery backoff until 2026-01-01T00:00:00.000Z: x")).toBe(
      "discovery_backoff"
    );
  });

  test("Discovery backoff without until is stopped", () => {
    expect(classifyWorkerError("Discovery backoff")).toBe("stopped");
  });

  test("any other string is stopped", () => {
    expect(classifyWorkerError("artifact disk is full")).toBe("stopped");
  });
});
