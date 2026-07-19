import type { SyncStatus } from "./api/contracts.ts";

export function isWorkerReady(activeState: SyncStatus["activeState"]) {
  return activeState !== "stopped";
}
