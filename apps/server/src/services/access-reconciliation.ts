import { ServiceAccessError } from "@merchbaseco/access";
import type postgres from "postgres";

import type { TmterminalAccess } from "../auth/service-access.ts";
import {
  createAccessProjectionStore,
  listActiveAccountProjectionMerchbaseUserIds,
} from "../queries/access-projection-store.ts";

const dailyReconciliationDelayMs = 24 * 60 * 60 * 1000;

export async function reconcileActiveProjectionAccess(
  database: postgres.Sql,
  access: TmterminalAccess["customer"]
) {
  const merchbaseUserIds = await listActiveAccountProjectionMerchbaseUserIds(database);
  const projections = createAccessProjectionStore(database);
  let denied = 0;
  let granted = 0;
  let removed = 0;

  for (const merchbaseUserId of merchbaseUserIds) {
    try {
      // Sequential by contract: Clerk repair remains bounded and stops on dependency failure.
      // biome-ignore lint/performance/noAwaitInLoops: see contract above.
      await access.refreshAccess(merchbaseUserId);
      granted += 1;
    } catch (error) {
      if (error instanceof ServiceAccessError && error.code === "access_denied") {
        denied += 1;
        continue;
      }
      if (error instanceof ServiceAccessError && error.code === "access_unavailable") {
        // A successful refresh can tombstone a deleted or malformed Clerk profile.
        const projection = await projections.findByMerchbaseUserId(merchbaseUserId);
        if (!projection) {
          removed += 1;
          continue;
        }
      }
      throw new Error("Daily Access Projection reconciliation failed", { cause: error });
    }
  }

  return { denied, granted, removed, total: merchbaseUserIds.length };
}

export function createAccessReconciliationScheduler(options: {
  delayMs?: number;
  onError?: (error: Error) => void;
  reconcile: () => Promise<unknown>;
}) {
  const delayMs = options.delayMs ?? dailyReconciliationDelayMs;
  let active: Promise<void> | undefined;
  let timer: Timer | undefined;
  let started = false;

  const run = () => {
    if (!(started && !active)) {
      return;
    }
    active = options
      .reconcile()
      .catch((error) => {
        (options.onError ?? console.error)(
          error instanceof Error ? error : new Error("Access reconciliation failed")
        );
      })
      .then(() => undefined)
      .finally(() => {
        active = undefined;
        if (started) {
          timer = setTimeout(run, delayMs);
        }
      });
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      run();
    },
    async stop() {
      started = false;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await active;
    },
  };
}
