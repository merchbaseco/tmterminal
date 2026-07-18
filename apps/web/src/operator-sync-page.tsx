import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppRouter } from "../../server/src/api/router.ts";
import { trpcErrorCode } from "./trpc-error-code.ts";

type Outputs = inferRouterOutputs<AppRouter>["ops"]["sync"];
interface PageInput {
  limit: number;
  offset: number;
}
export interface OperatorSyncApi {
  artifacts: (input: PageInput) => Promise<Outputs["artifacts"]>;
  status: () => Promise<Outputs["status"]>;
}

const limit = 25;
const timestamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value)
      )
    : "—";
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`)
      )
    : "—";
const count = (value: number) => new Intl.NumberFormat().format(value);
const providerLabels = { backoff: "Paused", ready: "Ready", stopped: "Stopped" } as const;

function relativeTimestamp(value: string) {
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) {
    return formatter.format(seconds, "second");
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return formatter.format(hours, "hour");
  }
  return formatter.format(Math.round(hours / 24), "day");
}

function syncStatusCopy(status: Outputs["status"]) {
  if (status.summary.activeState === "failed") {
    return {
      description: "A source file failed to process.",
      headline: "Corpus sync needs attention.",
    };
  }
  if (requiresOperator(status.summary.activeState)) {
    return {
      description: status.provider.currentError ?? "USPTO access needs operator attention.",
      headline: "Corpus sync needs attention.",
    };
  }
  if (status.summary.activeState === "backoff") {
    return {
      description: status.provider.nextEligibleAt
        ? `Retry scheduled for ${timestamp(status.provider.nextEligibleAt)}.`
        : "The next retry starts automatically.",
      headline: "Corpus sync paused.",
    };
  }
  if (status.summary.stale || status.summary.degraded) {
    return {
      description: status.summary.completeThroughDate
        ? `Complete trademark data currently runs through ${date(status.summary.completeThroughDate)}.`
        : "A complete trademark update is not available yet.",
      headline: "Corpus sync is delayed.",
    };
  }
  return {
    description: "Trademark Turtle continuously processes USPTO trademark data.",
    headline: "Corpus sync active.",
  };
}

function optionalCopy(status: Outputs["status"] | null) {
  return status ? syncStatusCopy(status) : null;
}

function requiresOperator(activeState: Outputs["status"]["summary"]["activeState"]) {
  return activeState === "stopped";
}

const artifactStateLabels: Record<Outputs["artifacts"]["items"][number]["state"], string> = {
  complete: "Complete",
  downloading: "Downloading",
  failed: "Failed",
  pending: "Waiting",
  projecting: "Processing",
};
const artifactStateClasses = {
  complete: "[&>span]:bg-foreground",
  downloading: "[&>span]:bg-primary",
  failed: "text-destructive-foreground [&>span]:bg-destructive-foreground",
  pending: "",
  projecting: "[&>span]:bg-primary",
} as const;

export function OperatorSyncPage({ api }: { api: OperatorSyncApi }) {
  const [status, setStatus] = useState<Outputs["status"] | null>(null);
  const [artifacts, setArtifacts] = useState<Outputs["artifacts"] | null>(null);
  const [error, setError] = useState<"forbidden" | "load" | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState(false);
  const pagePending = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.status(), api.artifacts({ limit, offset: 0 })])
      .then(([nextStatus, nextArtifacts]) => {
        if (active) {
          setStatus(nextStatus);
          setArtifacts(nextArtifacts);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(trpcErrorCode(cause) === "FORBIDDEN" ? "forbidden" : "load");
        }
      });
    return () => {
      active = false;
    };
  }, [api]);

  const loadPage = useCallback(
    async (offset: number) => {
      if (pagePending.current) {
        return;
      }
      pagePending.current = true;
      setPageLoading(true);
      setPageError(false);
      try {
        setArtifacts(await api.artifacts({ limit, offset }));
      } catch {
        setPageError(true);
      } finally {
        pagePending.current = false;
        setPageLoading(false);
      }
    },
    [api]
  );

  if (error === "forbidden") {
    return (
      <main className="isolate mx-auto min-h-[calc(100vh-3.75rem)] max-w-[100rem] px-[clamp(1rem,3vw,3rem)] py-[clamp(2rem,5vw,5.5rem)]">
        <p className="mb-[0.85rem] font-[650] text-[0.72rem] uppercase tracking-[0.12em]">
          Operations / sync
        </p>
        <h1 className="m-0 font-black text-[clamp(4.75rem,13vw,13rem)] leading-[0.78] tracking-[-0.055em]">
          ACCESS DENIED
        </h1>
        <p
          className="m-0 max-w-[29rem] text-[clamp(1.15rem,2vw,1.7rem)] leading-[1.15]"
          role="alert"
        >
          This page requires the server-side operator role.
        </p>
      </main>
    );
  }
  const copy = optionalCopy(status);
  return (
    <main
      aria-busy={!(status || error)}
      className="isolate mx-auto min-h-[calc(100vh-3.75rem)] max-w-[100rem] px-[clamp(1rem,3vw,3rem)] py-[clamp(2rem,5vw,5.5rem)]"
    >
      <p className="mb-[0.85rem] font-[650] text-[0.72rem] uppercase tracking-[0.12em]">
        Operations / sync
      </p>
      {error === "load" ? (
        <p className="m-0 py-8 text-destructive-foreground" role="alert">
          Sync operations could not be loaded.
        </p>
      ) : null}
      {status || error ? null : <p className="m-0 py-8">Loading sync status…</p>}
      {status && copy ? (
        <>
          <header
            className={cn(
              "max-w-[80rem] border-foreground border-t-[3px] pt-4",
              requiresOperator(status.summary.activeState) && "border-destructive-foreground"
            )}
          >
            <h1
              className={cn(
                "m-0 max-w-[25ch] font-extrabold text-[clamp(2.25rem,4vw,3rem)] leading-[0.78] tracking-[-0.04em]",
                requiresOperator(status.summary.activeState) && "text-destructive-foreground"
              )}
            >
              {copy.headline}
            </h1>
            <p className="mt-[clamp(1.5rem,3vw,2.5rem)] mb-0 max-w-[45rem] font-[550] text-[1.15rem] text-muted-foreground">
              {copy.description}
            </p>
          </header>
          <section
            aria-label="Corpus sync status"
            className="@container mt-[clamp(2rem,4vw,3.5rem)]"
          >
            <dl className="m-0 grid @min-[48rem]:grid-cols-3 @min-[78rem]:grid-cols-6 grid-cols-1 border-border border-y tabular-nums [&>div:first-child]:border-t-0 @min-[78rem]:[&>div:first-child]:border-l-0 @min-[78rem]:[&>div:first-child]:pl-0 @min-[78rem]:[&>div:last-child]:pr-0 @min-[48rem]:[&>div:nth-child(3n)]:pr-0 @min-[48rem]:[&>div:nth-child(3n+1)]:border-l-0 @min-[48rem]:[&>div:nth-child(3n+1)]:pl-0 @min-[78rem]:[&>div:nth-child(n)]:border-t-0 @min-[78rem]:[&>div:nth-child(n)]:border-l @min-[78rem]:[&>div:nth-child(n)]:px-5 @min-[48rem]:[&>div:nth-child(n+4)]:border-t [&>div]:grid [&>div]:gap-1 [&>div]:border-border [&>div]:border-t @min-[48rem]:[&>div]:border-t-0 @min-[48rem]:[&>div]:border-l @min-[48rem]:[&>div]:px-5 [&>div]:py-[0.85rem] [&_dd]:m-0 [&_dd]:font-[650] [&_dd]:text-[1.15rem] [&_dt]:whitespace-nowrap [&_dt]:text-muted-foreground">
              <div>
                <dt>Marks processed</dt>
                <dd>{count(status.source.projectedMarkCount)}</dd>
              </div>
              <div>
                <dt>Source records processed</dt>
                <dd>{count(status.source.physicalRecordCount)}</dd>
              </div>
              <div>
                <dt>Complete through</dt>
                <dd>{date(status.summary.completeThroughDate)}</dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd>
                  {status.source.lastActivityAt ? (
                    <time
                      dateTime={status.source.lastActivityAt}
                      title={timestamp(status.source.lastActivityAt)}
                    >
                      {relativeTimestamp(status.source.lastActivityAt)}
                    </time>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Sync issues</dt>
                <dd>{status.annualBaseline.failedArtifactCount}</dd>
              </div>
              <div>
                <dt>USPTO connection</dt>
                <dd>{providerLabels[status.provider.status]}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : null}
      {artifacts ? (
        <section className="mt-[clamp(2.5rem,5vw,4.5rem)]">
          <div className="flex items-baseline justify-between gap-4 border-border border-t pt-3 max-[48rem]:grid max-[48rem]:gap-1">
            <h2 className="m-0 font-[650] text-[1.35rem]">Source files</h2>
            <p className="m-0 text-muted-foreground">{artifacts.total} files · read-only</p>
          </div>
          <div className="mx-[calc(clamp(1rem,3vw,3rem)*-1)] overflow-x-auto whitespace-nowrap">
            <div className="inline-block min-w-full px-[clamp(1rem,3vw,3rem)] align-middle">
              <table
                aria-label="Source files"
                className="w-full border-collapse [&_code]:ml-2 [&_code]:text-muted-foreground [&_td:first-child_code]:before:mr-2 [&_td:first-child_code]:before:content-['·'] [&_td]:border-border [&_td]:border-t [&_td]:px-0 [&_td]:py-3 [&_td]:pr-6 [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:px-0 [&_th]:py-3 [&_th]:pr-6 [&_th]:text-left [&_th]:font-[650] [&_th]:text-[0.8rem] [&_th]:text-muted-foreground [&_th]:tracking-[0.04em]"
              >
                <thead>
                  <tr>
                    <th>File</th>
                    <th>State</th>
                    <th className="text-right!">Records</th>
                    <th className="text-right!">Marks</th>
                    <th>Coverage</th>
                    <th>Updated</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {artifacts.items.map((artifact) => (
                    <tr key={artifact.artifactId}>
                      <td>
                        <strong>{artifact.filename}</strong>
                        {artifact.sha256 ? <code>{artifact.sha256.slice(0, 12)}</code> : null}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex items-center gap-2 font-semibold [&>span]:size-2 [&>span]:rounded-full [&>span]:bg-muted-foreground",
                            artifactStateClasses[artifact.state]
                          )}
                          data-state={artifact.state}
                        >
                          <span aria-hidden="true" />
                          {artifactStateLabels[artifact.state]}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">
                        {count(artifact.physicalRecordCount)}
                      </td>
                      <td className="text-right tabular-nums">
                        {count(artifact.projectedMarkCount)}
                      </td>
                      <td>
                        {date(artifact.sourceFromDate)} — {date(artifact.sourceToDate)}
                      </td>
                      <td>
                        <time dateTime={artifact.updatedAt} title={timestamp(artifact.updatedAt)}>
                          {relativeTimestamp(artifact.updatedAt)}
                        </time>
                      </td>
                      <td
                        className={
                          artifact.currentError
                            ? "max-w-[22rem] overflow-hidden text-ellipsis text-destructive-foreground"
                            : undefined
                        }
                        title={artifact.currentError ?? undefined}
                      >
                        {artifact.currentError ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {pageError ? (
            <p className="m-0 py-8 text-destructive-foreground" role="alert">
              Source-file page could not be loaded; the previous page remains shown.
            </p>
          ) : null}
          <Pagination
            loading={pageLoading}
            offset={artifacts.offset}
            onPage={loadPage}
            total={artifacts.total}
          />
        </section>
      ) : null}
      {status ? <SystemDetails status={status} /> : null}
    </main>
  );
}

function SystemDetails({ status }: { status: Outputs["status"] }) {
  return (
    <section className="mt-[clamp(2.5rem,5vw,4.5rem)]">
      <div className="flex items-baseline justify-between gap-4 border-border border-t pt-3 max-[48rem]:grid max-[48rem]:gap-1">
        <h2 className="m-0 font-[650] text-[1.35rem]">System details</h2>
        <p className="m-0 text-muted-foreground">Corpus and provider state</p>
      </div>
      <table
        aria-label="System details"
        className="w-full border-collapse tabular-nums [&_code]:ml-2 [&_code]:text-muted-foreground [&_td]:border-border [&_td]:border-t [&_td]:py-3 [&_td]:text-left [&_td]:align-top [&_td]:text-muted-foreground [&_th]:w-[min(18rem,35%)] [&_th]:whitespace-nowrap [&_th]:border-border [&_th]:border-t [&_th]:py-3 [&_th]:pr-8 [&_th]:text-left [&_th]:align-top [&_th]:font-semibold"
      >
        <tbody>
          <tr>
            <th scope="row">Source system</th>
            <td>USPTO trademark XML</td>
          </tr>
          <tr>
            <th scope="row">Data version</th>
            <td>{status.summary.dataVersion}</td>
          </tr>
          {status.summary.completeThroughDate ? (
            <tr>
              <th scope="row">Complete through</th>
              <td>{date(status.summary.completeThroughDate)}</td>
            </tr>
          ) : null}
          {status.summary.lastSuccessfulUpdateAt ? (
            <tr>
              <th scope="row">Last update</th>
              <td>{timestamp(status.summary.lastSuccessfulUpdateAt)}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">Provider status</th>
            <td>{providerLabels[status.provider.status]}</td>
          </tr>
          <tr>
            <th scope="row">Provider failures</th>
            <td>{status.provider.failureCount}</td>
          </tr>
          {status.provider.nextEligibleAt ? (
            <tr>
              <th scope="row">Next retry</th>
              <td>{timestamp(status.provider.nextEligibleAt)}</td>
            </tr>
          ) : null}
          {status.provider.currentError ? (
            <tr>
              <th scope="row">Provider error</th>
              <td className="max-w-[22rem] overflow-hidden text-ellipsis text-destructive-foreground">
                {status.provider.currentError}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

function Pagination({
  loading,
  offset,
  onPage,
  total,
}: {
  loading: boolean;
  offset: number;
  onPage: (offset: number) => void;
  total: number;
}) {
  const previousPage = useCallback(() => onPage(Math.max(0, offset - limit)), [offset, onPage]);
  const nextPage = useCallback(() => onPage(offset + limit), [offset, onPage]);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-end gap-4 pt-4 [&_p]:m-0">
      <Button disabled={loading || offset === 0} onClick={previousPage} variant="outline">
        Previous
      </Button>
      <p className="tabular-nums">
        {total === 0 ? 0 : offset + 1}–{Math.min(total, offset + limit)} of {total}
      </p>
      <Button disabled={loading || offset + limit >= total} onClick={nextPage} variant="outline">
        Next
      </Button>
    </nav>
  );
}
