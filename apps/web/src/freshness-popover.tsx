import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { AppRouter } from "../../server/src/api/router.ts";

type SyncStatus = inferRouterOutputs<AppRouter>["sync"]["status"];

export interface FreshnessApi {
  status: () => Promise<SyncStatus>;
}

function date(value: string | null) {
  if (!value) {
    return "Not yet available";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}

function timestamp(value: string | null) {
  if (!value) {
    return "Not yet available";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}

function statusLabel(status: SyncStatus) {
  if (status.completeThroughDate && status.stale) {
    return status.staleSince
      ? `Stale since ${date(status.staleSince.slice(0, 10))}`
      : "Update delayed";
  }
  const labels: Record<SyncStatus["activeState"], string> = {
    backoff: "Sync paused — retrying source access",
    downloading: "Syncing — downloading source data",
    failed: "Update needs operator attention",
    idle: status.completeThroughDate ? "Up to date" : "Sync active",
    parsing: "Syncing — processing source data",
    stopped: "Update needs operator attention",
  };
  return labels[status.activeState];
}

export function FreshnessPopover({ api }: { api: FreshnessApi }) {
  const {
    data: status,
    isError,
    isPending,
    refetch,
  } = useQuery({
    queryFn: api.status,
    queryKey: ["sync.status"],
    staleTime: 5 * 60 * 1000,
  });
  const refreshOnOpen = useCallback(
    (open: boolean) => {
      if (open) {
        refetch();
      }
    },
    [refetch]
  );

  return (
    <Popover onOpenChange={refreshOnOpen}>
      <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
        Corpus freshness
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-80">
        <div className="grid gap-4">
          <div className="grid gap-1">
            <PopoverTitle>Corpus freshness</PopoverTitle>
            <p className="text-base text-muted-foreground sm:text-sm">
              Contiguous searchable coverage, not the newest downloaded file.
            </p>
          </div>
          {isError ? (
            <p className="text-base text-destructive-foreground sm:text-sm" role="alert">
              Freshness could not be loaded.
            </p>
          ) : null}
          {isPending ? (
            <p className="text-base text-muted-foreground sm:text-sm">Loading freshness…</p>
          ) : null}
          {status ? (
            <dl className="freshness-facts tabular-nums">
              <div>
                <dt>Status</dt>
                <dd>{statusLabel(status)}</dd>
              </div>
              <div>
                <dt>Complete through</dt>
                <dd>{date(status.completeThroughDate)}</dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>{timestamp(status.lastSuccessfulUpdateAt)}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
