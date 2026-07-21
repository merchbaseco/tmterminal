import type { SyncStatus } from "./api/contracts.ts";

export function isWorkerReady(
  activeState: SyncStatus["activeState"],
  firstReconciliationComplete: boolean
) {
  return firstReconciliationComplete && activeState !== "failed";
}
