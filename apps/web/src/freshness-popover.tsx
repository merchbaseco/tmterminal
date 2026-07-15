import type { inferRouterOutputs } from "@trpc/server";
import { useRef, useState } from "react";

import type { AppRouter } from "../../server/src/api/router.ts";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

type SyncStatus = inferRouterOutputs<AppRouter>["sync"]["status"];

export type FreshnessApi = {
  status(): Promise<SyncStatus>;
};

function date(value: string | null) {
  if (!value) return "Not yet available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function timestamp(value: string | null) {
  if (!value) return "Not yet available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function FreshnessPopover({ api }: { api: FreshnessApi }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  return (
    <Popover onOpenChange={(open) => {
      if (!open) return;
      const currentRequest = ++request.current;
      setFailed(false);
      void api.status().then((nextStatus) => {
        if (request.current === currentRequest) setStatus(nextStatus);
      }).catch(() => {
        if (request.current === currentRequest) setFailed(true);
      });
    }}>
      <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
        {status?.completeThroughDate ? `Corpus through ${date(status.completeThroughDate)}` : "Corpus freshness"}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-80">
        <div className="grid gap-4">
          <div className="grid gap-1">
            <PopoverTitle>Corpus freshness</PopoverTitle>
            <p className="text-base text-muted-foreground sm:text-sm">Contiguous searchable coverage, not the newest downloaded file.</p>
          </div>
          {failed ? <p className="text-base text-destructive-foreground sm:text-sm" role="alert">Freshness could not be loaded.</p> : null}
          {!failed && !status ? <p className="text-base text-muted-foreground sm:text-sm">Loading freshness…</p> : null}
          {status ? (
            <dl className="freshness-facts tabular-nums">
              <div><dt>Complete through</dt><dd>{date(status.completeThroughDate)}</dd></div>
              <div><dt>Newest published</dt><dd>{date(status.publishedThroughDate)}</dd></div>
              <div><dt>Last merge</dt><dd>{timestamp(status.lastSuccessfulMergeAt)}</dd></div>
              <div><dt>Current state</dt><dd>{status.activeState}</dd></div>
              <div><dt>Freshness</dt><dd>{status.stale
                ? status.staleSince ? `Stale since ${date(status.staleSince.slice(0, 10))}` : "Stale; no corpus frontier"
                : "Current"}</dd></div>
              <div><dt>Outstanding</dt><dd>{status.pendingCount} pending · {status.failedCount} failed</dd></div>
              <div><dt>Diagnostics</dt><dd>{status.rejectCount} rejected · {status.quarantineCount} quarantined</dd></div>
            </dl>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
