import type postgres from "postgres";

import {
  classifyWorkerError,
  discoveryIntervalMs,
  type WorkerErrorKind,
  workerHeartbeatStaleAfterMs,
} from "../ingestion/trademark-ingestion.ts";

export type HealthCheckName = "database" | "worker" | "uspto_data";

export type HealthReport =
  | { readonly status: "ok" }
  | {
      readonly status: "degraded";
      readonly failing: readonly [HealthCheckName, ...HealthCheckName[]];
    };

export type HealthRead =
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "read";
      readonly observedAt: Date;
      readonly workerHeartbeatAt: Date | null;
      readonly workerError: WorkerErrorKind;
      readonly lastSuccessfulUpdateAt: Date | null;
    };

const healthReadDeadlineMs = 2000;
const usptoDataStaleAfterMs = 4 * discoveryIntervalMs;

interface HealthRow {
  currentError: string | null;
  lastSuccessfulUpdateAt: Date | null;
  observedAt: Date;
  workerHeartbeatAt: Date | null;
}

export function judgeHealth(read: HealthRead): HealthReport {
  switch (read.kind) {
    case "unreadable":
      return degraded(["database"]);
    case "read":
      return judgeReadable(read);
    default:
      return read satisfies never;
  }
}

export async function checkHealth(database: postgres.Sql): Promise<HealthReport> {
  try {
    return judgeHealth(await readHealth(database));
  } catch {
    return degraded(["database"]);
  }
}

function degraded(failing: readonly [HealthCheckName, ...HealthCheckName[]]): HealthReport {
  // biome-ignore assist/source/useSortedKeys: The readiness body is exact bytes, with status before failing.
  return { status: "degraded", failing };
}

function judgeReadable(read: Extract<HealthRead, { kind: "read" }>): HealthReport {
  const failing: HealthCheckName[] = [];
  if (workerIsFailing(read)) {
    failing.push("worker");
  }
  if (usptoDataIsFailing(read)) {
    failing.push("uspto_data");
  }
  const [first, ...rest] = failing;
  if (first === undefined) {
    return { status: "ok" };
  }
  return degraded([first, ...rest]);
}

function workerIsFailing(read: Extract<HealthRead, { kind: "read" }>): boolean {
  const workerError: WorkerErrorKind = read.workerError;
  switch (workerError) {
    case "stopped":
      return true;
    case "none":
    case "discovery_backoff":
      return (
        read.workerHeartbeatAt === null ||
        Math.max(0, read.observedAt.getTime() - read.workerHeartbeatAt.getTime()) >
          workerHeartbeatStaleAfterMs
      );
    default: {
      const unreachable: never = workerError;
      return unreachable;
    }
  }
}

function usptoDataIsFailing(read: Extract<HealthRead, { kind: "read" }>) {
  if (read.lastSuccessfulUpdateAt === null) {
    return true;
  }
  return (
    Math.max(0, read.observedAt.getTime() - read.lastSuccessfulUpdateAt.getTime()) >
    usptoDataStaleAfterMs
  );
}

async function readHealth(database: postgres.Sql): Promise<HealthRead> {
  let timer: Timer | undefined;
  try {
    const query = database<HealthRow[]>`
      select current_timestamp as "observedAt",
        worker.last_heartbeat_at as "workerHeartbeatAt",
        worker.current_error as "currentError",
        state.last_successful_update_at as "lastSuccessfulUpdateAt"
      from (select 1) anchor
      left join worker_status worker on worker.id = 'uspto'
      left join data_state state on state.id = 'uspto'
    `;
    const rows = await Promise.race([
      query,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          query.cancel();
          reject(new Error("health read deadline"));
        }, healthReadDeadlineMs);
      }),
    ]);
    const [row] = rows;
    if (!row) {
      return { kind: "unreadable" };
    }
    return {
      kind: "read",
      lastSuccessfulUpdateAt: row.lastSuccessfulUpdateAt,
      observedAt: row.observedAt,
      workerError: classifyWorkerError(row.currentError),
      workerHeartbeatAt: row.workerHeartbeatAt,
    };
  } catch {
    return { kind: "unreadable" };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
