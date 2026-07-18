import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useRef, useState } from "react";
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

function freshness(status: SyncStatus) {
  if (!status.stale) {
    return "Current";
  }
  return status.staleSince
    ? `Stale since ${date(status.staleSince.slice(0, 10))}`
    : "Baseline sync in progress";
}

export function FreshnessPopover({ api }: { api: FreshnessApi }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        return;
      }
      request.current += 1;
      const currentRequest = request.current;
      setFailed(false);
      api
        .status()
        .then((nextStatus) => {
          if (request.current === currentRequest) {
            setStatus(nextStatus);
          }
        })
        .catch(() => {
          if (request.current === currentRequest) {
            setFailed(true);
          }
        });
    },
    [api]
  );

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
        {status?.completeThroughDate
          ? `Data through ${date(status.completeThroughDate)}`
          : "Data freshness"}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-80">
        <div className="grid gap-4">
          <div className="grid gap-1">
            <PopoverTitle>Data freshness</PopoverTitle>
            <p className="text-base text-muted-foreground sm:text-sm">
              Search stays available while source coverage advances.
            </p>
          </div>
          {failed ? (
            <p className="text-base text-destructive-foreground sm:text-sm" role="alert">
              Freshness could not be loaded.
            </p>
          ) : null}
          {failed || status ? null : (
            <p className="text-base text-muted-foreground sm:text-sm">Loading freshness…</p>
          )}
          {status ? (
            <dl className="freshness-facts tabular-nums">
              <div>
                <dt>Complete through</dt>
                <dd>{date(status.completeThroughDate)}</dd>
              </div>
              <div>
                <dt>Data version</dt>
                <dd>{status.dataVersion}</dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>{timestamp(status.lastSuccessfulUpdateAt)}</dd>
              </div>
              <div>
                <dt>Current state</dt>
                <dd>{status.activeState}</dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>{freshness(status)}</dd>
              </div>
              <div>
                <dt>Outstanding</dt>
                <dd>
                  {status.pendingCount} pending · {status.failedCount} failed
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
