import type postgres from "postgres";

import type { SyncService, SyncStatus } from "../api/contracts.ts";
import { readSyncFacts, type SyncFacts } from "../queries/sync-repository.ts";

const stalenessGraceDays = 3;

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function earliest(dates: Array<Date | null>) {
  const present = dates.filter((date): date is Date => date !== null);
  return present.length === 0 ? null : new Date(Math.min(...present.map((date) => date.getTime())));
}

export function syncStatusFromFacts(facts: SyncFacts): SyncStatus {
      const staleSince = facts.completeThroughDate
        ? addDays(facts.completeThroughDate, stalenessGraceDays + 1)
        : null;
      const stale = staleSince === null || facts.currentDate >= staleSince.slice(0, 10);
      const gap = facts.publishedThroughDate !== null && facts.completeThroughDate !== null &&
        facts.publishedThroughDate > facts.completeThroughDate;

      let activeState: SyncStatus["activeState"] = "idle";
      let activeSince: Date | null = null;
      if (facts.laneStatus === "backoff") {
        activeState = "backoff";
        activeSince = facts.laneUpdatedAt;
      }
      if (facts.laneStatus === "stopped") {
        activeState = "stopped";
        activeSince = facts.laneUpdatedAt;
      }
      if (facts.reissueSelectionRequiredCount > 0) {
        activeState = "operator-action-required";
        activeSince = facts.reissueSelectionRequiredSince;
      }
      if (facts.reconcileFailedSince) {
        activeState = "failed";
        activeSince = facts.reconcileFailedSince;
      }
      if (facts.activeAttemptKind) {
        activeState = facts.activeAttemptKind === "discovery" ? "discovering" : "downloading";
        activeSince = facts.activeAttemptStartedAt;
      } else if (facts.reconcileActiveSince && facts.hasParseTarget) {
        activeState = "parsing";
        activeSince = facts.reconcileActiveSince;
      } else if (facts.reconcileActiveSince && facts.hasPublicationTarget) {
        activeState = "publishing";
        activeSince = facts.reconcileActiveSince;
      }

      const failedCount = facts.failedCount + (facts.reconcileFailedSince ? 1 : 0);
      const degraded = stale || gap || failedCount > 0 || facts.rejectCount > 0 || facts.quarantineCount > 0 ||
        facts.reissueSelectionRequiredCount > 0 || facts.laneStatus === "backoff" || facts.laneStatus === "stopped" ||
        activeState === "failed" || facts.completeThroughDate === null;
      const noCorpus = facts.completeThroughDate === null;
      const degradedSince = !degraded || noCorpus
        ? null
        : earliest([
            failedCount > 0 ? earliest([facts.failedSince, facts.reconcileFailedSince]) : null,
            facts.rejectCount > 0 || facts.quarantineCount > 0 ? facts.rejectedSince : null,
            facts.reissueSelectionRequiredCount > 0 ? facts.reissueSelectionRequiredSince : null,
            gap ? facts.lastSuccessfulMergeAt : null,
            stale && staleSince ? new Date(staleSince) : null,
            facts.laneStatus === "backoff" || facts.laneStatus === "stopped" ? facts.laneUpdatedAt : null,
            activeState === "failed" ? activeSince : null,
          ]);

      return {
        activeState,
        completeThroughDate: facts.completeThroughDate,
        corpusVersion: facts.corpusVersion,
        degraded,
        degradedSince: degradedSince?.toISOString() ?? null,
        failedCount,
        lastSuccessfulMergeAt: facts.lastSuccessfulMergeAt?.toISOString() ?? null,
        pendingCount: facts.pendingCount,
        publishedThroughDate: facts.publishedThroughDate,
        quarantineCount: facts.quarantineCount,
        rejectCount: facts.rejectCount,
        reissueSelectionRequiredCount: facts.reissueSelectionRequiredCount,
        stale,
        staleSince: stale ? staleSince : null,
      };
}

export function createSyncService(database: postgres.Sql): SyncService {
  return {
    async status(): Promise<SyncStatus> {
      return syncStatusFromFacts(await readSyncFacts(database));
    },
  };
}
