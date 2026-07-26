import type { inferRouterOutputs } from "@trpc/server";
import { curveMonotoneX } from "@visx/curve";
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Line, LineChart } from "@/components/charts/line-chart";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { TooltipRow } from "@/components/charts/tooltip/tooltip-content";
import { XAxis } from "@/components/charts/x-axis";
import { Button } from "@/components/ui/button";
import type { PublicSourceStatus } from "../../server/src/api/contracts.ts";
import type { AppRouter } from "../../server/src/api/router.ts";
import { StatusPageSkeleton } from "./status-page-skeleton.tsx";

type Outputs = inferRouterOutputs<AppRouter>["ops"]["sync"];
type Artifact = Outputs["artifacts"]["items"][number];
type AttentionItem = Outputs["status"]["attention"]["items"][number];
type ArtifactFilter = "all" | "needs-attention";

interface PageInput {
  filter: ArtifactFilter;
  limit: number;
  offset: number;
}

export interface OperatorSyncApi {
  artifacts: (input: PageInput) => Promise<Outputs["artifacts"]>;
  status: () => Promise<Outputs["status"]>;
}

export interface PublicStatusApi {
  status: () => Promise<PublicSourceStatus>;
}

const limit = 25;
const activityChartMargin = { bottom: 52, left: 0, right: 0, top: 12 };
const count = (value: number) => new Intl.NumberFormat().format(value);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`)
      )
    : "No files yet";
const year = (value: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: "UTC", year: "numeric" }).format(
    new Date(`${value}T00:00:00Z`)
  );
const timestamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value)
      )
    : "—";

function activityTooltipRows(point: Record<string, unknown>): TooltipRow[] {
  return [
    {
      color: "var(--chart-line-secondary)",
      label: "New applications",
      value: Number(point.newApplications ?? 0),
    },
    {
      color: "var(--chart-line-primary)",
      label: "Application updates",
      value: Number(point.applicationUpdates ?? 0),
    },
  ];
}

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
  return Math.abs(hours) < 24
    ? formatter.format(hours, "hour")
    : formatter.format(Math.round(hours / 24), "day");
}

function artifactState(artifact: Artifact) {
  if (artifact.processingDisposition === "covered") {
    return {
      label: "Not downloaded · Covered by newer source data",
      tone: "text-muted-foreground",
    };
  }
  if (artifact.processingDisposition === "deferred") {
    return {
      label: "Not required · Selected broad source pending",
      tone: "text-muted-foreground",
    };
  }
  if (artifact.applicationState === "complete") {
    return {
      label: artifact.storageState === "cleaned-up" ? "Complete · Cleaned up" : "Complete",
      tone: "text-foreground",
    };
  }
  if (artifact.downloadState === "blocked" || artifact.applicationState === "needs_attention") {
    return { label: "Needs attention", tone: "text-destructive-foreground" };
  }
  if (artifact.applicationState === "applying") {
    return { label: "Processing", tone: "text-primary" };
  }
  if (artifact.downloadState === "downloading") {
    return { label: "Downloading", tone: "text-primary" };
  }
  return { label: "Waiting", tone: "text-muted-foreground" };
}

function attentionMessage(item: AttentionItem) {
  if (item.stage === "worker") {
    return item.message ?? "The ingestion worker needs attention.";
  }
  if (item.httpStatus === 429 && item.providerRequestCount && item.retryNotBefore) {
    return `The USPTO temporarily blocked this file after ${count(item.providerRequestCount)} requests. Try again after ${timestamp(item.retryNotBefore)}.`;
  }
  if (item.httpStatus === 429) {
    return "The USPTO rate-limited this download. It needs a new download attempt.";
  }
  if (item.stage === "application") {
    return "This file downloaded but could not be processed. It needs reprocessing.";
  }
  return "This file could not be downloaded. It needs a new download attempt.";
}

export function StatusPage({
  api,
  operatorApi,
}: {
  api: PublicStatusApi;
  operatorApi?: OperatorSyncApi;
}) {
  const [status, setStatus] = useState<PublicSourceStatus | null>(null);
  const [operatorStatus, setOperatorStatus] = useState<Outputs["status"] | null>(null);
  const [artifacts, setArtifacts] = useState<Outputs["artifacts"] | null>(null);
  const [artifactFilter, setArtifactFilter] = useState<ArtifactFilter>("all");
  const [error, setError] = useState<"load" | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<"filter" | "page" | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const pagePending = useRef(false);

  useEffect(() => {
    let active = true;
    const request = operatorApi
      ? Promise.all([
          operatorApi.status(),
          operatorApi.artifacts({ filter: "all", limit, offset: 0 }),
        ]).then(([nextStatus, nextArtifacts]) => ({ nextArtifacts, nextStatus }))
      : api.status().then((nextStatus) => ({ nextArtifacts: null, nextStatus }));
    request
      .then(({ nextArtifacts, nextStatus }) => {
        if (active) {
          setStatus(nextStatus);
          setOperatorStatus(operatorApi ? (nextStatus as Outputs["status"]) : null);
          setArtifacts(nextArtifacts);
        }
      })
      .catch(() => {
        if (active) {
          setError("load");
        }
      });
    return () => {
      active = false;
    };
  }, [api, operatorApi]);

  const loadMore = useCallback(async () => {
    if (pagePending.current || !artifacts || artifacts.items.length >= artifacts.total) {
      return;
    }
    pagePending.current = true;
    setPageLoading(true);
    setPageError(null);
    try {
      if (!operatorApi) {
        return;
      }
      const page = await operatorApi.artifacts({
        filter: artifactFilter,
        limit,
        offset: artifacts.items.length,
      });
      setArtifacts((current) =>
        current ? { ...page, items: [...current.items, ...page.items], offset: 0 } : page
      );
    } catch {
      setPageError("page");
    } finally {
      pagePending.current = false;
      setPageLoading(false);
    }
  }, [artifactFilter, artifacts, operatorApi]);

  const selectArtifactFilter = useCallback(
    async (filter: ArtifactFilter) => {
      if (!(operatorApi && artifacts) || filter === artifactFilter || pagePending.current) {
        return;
      }
      pagePending.current = true;
      setPageLoading(true);
      setPageError(null);
      try {
        const page = await operatorApi.artifacts({ filter, limit, offset: 0 });
        setArtifacts(page);
        setArtifactFilter(filter);
      } catch {
        setPageError("filter");
      } finally {
        pagePending.current = false;
        setPageLoading(false);
      }
    },
    [artifactFilter, artifacts, operatorApi]
  );

  const hasMore = Boolean(artifacts && artifacts.items.length < artifacts.total);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!(target && hasMore) || pageError) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: "500px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore, pageError]);

  return (
    <main
      aria-busy={!(status || error)}
      className="page-shell page-start isolate min-h-[calc(100dvh-var(--topbar-height,4.5rem))] pb-[clamp(2rem,5vw,5.5rem)]"
    >
      <h1 className="sr-only">Status</h1>
      {error === "load" ? (
        <p className="m-0 border border-border px-4 py-5 text-destructive-foreground" role="alert">
          Status could not be loaded.
        </p>
      ) : null}
      {status || error ? null : <StatusPageSkeleton />}
      {status ? (
        <>
          <ProcessingActivity status={status} />
          {status.source.currentArtifact ? (
            <p className="mt-6 mb-0 border border-border px-4 py-3 text-muted-foreground">
              {currentActivityLabel(status.source.currentArtifact.state)}{" "}
              <strong className="text-foreground">{status.source.currentArtifact.filename}</strong>.
              Processed data remains searchable.
            </p>
          ) : null}
          <AboutStatus />
        </>
      ) : null}
      {artifacts && operatorStatus ? (
        <SourceFiles
          artifacts={artifacts}
          attention={operatorStatus.attention}
          filter={artifactFilter}
          hasMore={hasMore}
          loadMore={loadMore}
          loadMoreRef={loadMoreRef}
          pageError={pageError}
          pageLoading={pageLoading}
          selectFilter={selectArtifactFilter}
        />
      ) : null}
    </main>
  );
}

function AboutStatus() {
  return (
    <section className="mt-[clamp(2.5rem,5vw,4.5rem)] grid grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] border border-border max-[48rem]:grid-cols-1">
      <h2 className="m-0 border-border border-r py-5 pr-[clamp(1.5rem,3vw,3rem)] pl-4 font-semibold text-base max-[48rem]:border-r-0 max-[48rem]:pr-4 max-[48rem]:pb-0">
        About this data
      </h2>
      <p className="m-0 max-w-[52rem] py-5 pr-4 pl-[clamp(1.5rem,3vw,3rem)] text-muted-foreground max-[48rem]:pt-3 max-[48rem]:pl-4">
        Trademark Terminal processes official USPTO trademark records for International Class 025.
        Learn how search modes, statuses, and mark types work on the{" "}
        <a className="text-foreground underline underline-offset-4" href="/help">
          Help page
        </a>
        .
      </p>
    </section>
  );
}

function SourceFiles({
  artifacts,
  attention,
  filter,
  hasMore,
  loadMore,
  loadMoreRef,
  pageError,
  pageLoading,
  selectFilter,
}: {
  artifacts: Outputs["artifacts"];
  attention: Outputs["status"]["attention"];
  filter: ArtifactFilter;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  pageError: "filter" | "page" | null;
  pageLoading: boolean;
  selectFilter: (filter: ArtifactFilter) => Promise<void>;
}) {
  return (
    <section
      aria-busy={pageLoading}
      aria-labelledby="source-files-heading"
      className="@container mt-[clamp(2.5rem,5vw,4.5rem)] border-border border-x border-t"
    >
      <div className="grid min-h-16 @min-[42rem]:grid-cols-[minmax(0,1fr)_auto] items-stretch border-border border-b bg-muted/45">
        <div className="flex items-center px-4 py-3">
          <h2 className="m-0 font-semibold text-base" id="source-files-heading">
            Source files
          </h2>
        </div>
        <SourceFileFilters
          counts={artifacts.counts}
          disabled={pageLoading}
          filter={filter}
          selectFilter={selectFilter}
        />
      </div>
      {attention.total > 0 ? <AttentionItems attention={attention} /> : null}
      <div className="overflow-x-auto">
        <table
          aria-label="Source files"
          className="w-full min-w-[56rem] table-fixed border-collapse"
        >
          <colgroup>
            <col className="w-[45%]" />
            <col className="w-[24%]" />
            <col className="w-[21%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="bg-muted/25">
            <tr className="border-border border-b">
              <th
                className="py-3 pr-6 pl-4 text-left font-medium text-muted-foreground text-sm"
                scope="col"
              >
                File
              </th>
              <th className="py-3 text-left font-medium text-muted-foreground text-sm" scope="col">
                Status
              </th>
              <th className="py-3 text-left font-medium text-muted-foreground text-sm" scope="col">
                Processed
              </th>
              <th
                className="py-3 pr-4 text-right font-medium text-muted-foreground text-sm"
                scope="col"
              >
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {artifacts.items.map((artifact) => {
              const state = artifactState(artifact);
              return (
                <tr className="border-border border-b" key={artifact.artifactId}>
                  <th
                    className="overflow-hidden text-ellipsis whitespace-nowrap py-3 pr-6 pl-4 text-left font-semibold"
                    scope="row"
                  >
                    {artifact.filename}
                  </th>
                  <td className={`whitespace-nowrap py-3 pr-6 ${state.tone}`}>{state.label}</td>
                  <td className="whitespace-nowrap py-3 pr-6 text-muted-foreground tabular-nums">
                    {count(artifact.physicalRecordCount)} records →{" "}
                    {count(artifact.projectedMarkCount)} marks
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4 text-right text-muted-foreground">
                    <time dateTime={artifact.updatedAt} title={timestamp(artifact.updatedAt)}>
                      {relativeTimestamp(artifact.updatedAt)}
                    </time>
                  </td>
                </tr>
              );
            })}
            {artifacts.items.length === 0 ? (
              <tr className="border-border border-b">
                <td className="px-4 py-8 text-muted-foreground" colSpan={4}>
                  No source files match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pageLoading ? (
        <p className="m-0 border-border border-b px-4 py-8 text-muted-foreground" role="status">
          Loading more source files…
        </p>
      ) : null}
      {pageError ? (
        <div className="flex items-center justify-between gap-4 border-border border-b px-4 py-4">
          <p className="m-0 text-destructive-foreground" role="alert">
            {pageError === "filter"
              ? "That source-file filter could not be loaded."
              : "More source files could not be loaded."}
          </p>
          {pageError === "page" ? (
            <Button className="pill-button" onClick={loadMore} variant="outline">
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {!(pageLoading || pageError) && artifacts.total > limit && !hasMore ? (
        <p className="m-0 border-border border-b px-4 py-4 text-muted-foreground">
          All {artifacts.total} source files shown.
        </p>
      ) : null}
      <div aria-hidden="true" className="h-px" ref={loadMoreRef} />
    </section>
  );
}

const artifactFilterOptions: Array<{
  countKey: keyof Outputs["artifacts"]["counts"];
  label: string;
  value: ArtifactFilter;
}> = [
  { countKey: "all", label: "All", value: "all" },
  { countKey: "needsAttention", label: "Errors", value: "needs-attention" },
];

function SourceFileFilters({
  counts,
  disabled,
  filter,
  selectFilter,
}: {
  counts: Outputs["artifacts"]["counts"];
  disabled: boolean;
  filter: ArtifactFilter;
  selectFilter: (filter: ArtifactFilter) => Promise<void>;
}) {
  const handleFilterClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      selectFilter(event.currentTarget.value as ArtifactFilter);
    },
    [selectFilter]
  );

  return (
    <fieldset className="m-0 grid min-w-0 grid-cols-2 items-stretch border-0 border-border @min-[42rem]:border-l p-0">
      <legend className="sr-only">Filter source files</legend>
      {artifactFilterOptions.map((option) => {
        const optionCount = counts[option.countKey];
        const active = filter === option.value;
        return (
          <button
            aria-label={`${option.label}: ${count(optionCount)}`}
            aria-pressed={active}
            className={`relative inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-none border-0 border-border px-4 font-medium text-base focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px] sm:text-sm [&:not(:first-child)]:border-l ${
              active
                ? "bg-muted text-foreground hover:bg-muted/80"
                : "bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground"
            }`}
            disabled={disabled}
            key={option.value}
            onClick={handleFilterClick}
            type="button"
            value={option.value}
          >
            {option.label}
            <span
              className={`inline-flex min-w-5 items-center justify-center rounded-full px-1 tabular-nums ${
                active
                  ? "bg-background/70 text-foreground"
                  : "bg-foreground/8 text-muted-foreground"
              }`}
            >
              {count(optionCount)}
            </span>
            <span
              aria-hidden="true"
              className="-translate-1/2 pointer-events-none absolute top-1/2 left-1/2 pointer-fine:hidden size-[max(100%,3rem)]"
            />
          </button>
        );
      })}
    </fieldset>
  );
}

function AttentionItems({ attention }: { attention: Outputs["status"]["attention"] }) {
  return (
    <section aria-labelledby="attention-heading" id="needs-attention">
      <h3 className="sr-only" id="attention-heading">
        Needs attention
      </h3>
      {/* biome-ignore lint/a11y/noRedundantRoles: list-none can remove list semantics in WebKit. */}
      <ul className="m-0 list-none p-0" role="list">
        {attention.items.map((item) => (
          <li
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-border border-b px-4 py-4"
            key={item.artifactId}
          >
            <strong>{item.filename}</strong>
            <time className="text-muted-foreground" dateTime={item.updatedAt}>
              {relativeTimestamp(item.updatedAt)}
            </time>
            <p className="col-span-full m-0 text-destructive-foreground">
              {attentionMessage(item)}
            </p>
          </li>
        ))}
      </ul>
      {attention.total > attention.items.length ? (
        <p className="m-0 border-border border-b px-4 py-4 text-muted-foreground">
          {attention.total - attention.items.length} more source files need attention.
        </p>
      ) : null}
    </section>
  );
}

function currentActivityLabel(state: "applying" | "discovering" | "downloading") {
  if (state === "applying") {
    return "Processing";
  }
  if (state === "discovering") {
    return "Discovering";
  }
  return "Downloading";
}

function ProcessingActivity({ status }: { status: PublicSourceStatus }) {
  const points = status.source.applicationActivity;
  const [firstPoint] = points;
  if (!firstPoint) {
    return null;
  }
  const catalogStartYear = status.catalog.earliestFilingDate
    ? year(status.catalog.earliestFilingDate)
    : null;
  const newApplicationCount = points.reduce((total, point) => total + point.newApplications, 0);
  const applicationUpdateCount = points.reduce(
    (total, point) => total + point.applicationUpdates,
    0
  );
  const chartData = points.map((point) => ({
    applicationUpdates: point.applicationUpdates,
    date: new Date(`${point.date}T12:00:00`),
    newApplications: point.newApplications,
  }));
  return (
    <section
      aria-labelledby="processing-activity-heading"
      className="relative left-1/2 w-dvw -translate-x-1/2"
    >
      <h2 className="sr-only" id="processing-activity-heading">
        Trademark applications and updates
      </h2>
      <div className="page-shell @container pb-2 sm:pb-4">
        <div className="grid @min-[48rem]:grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <section aria-label="Trademark catalog">
            <dl className="m-0 grid @min-[36rem]:grid-cols-3 grid-cols-1 gap-x-[clamp(1rem,3vw,3rem)] gap-y-4">
              <div className="grid min-w-0">
                <dt className="truncate font-medium text-base text-foreground sm:text-sm">
                  Total trademarks
                </dt>
                <dd className="m-0 truncate font-semibold text-[clamp(1.75rem,2.5vw,2.25rem)] tabular-nums leading-9 tracking-[-0.035em]">
                  {count(status.catalog.totalMarkCount)}
                </dd>
                <p className="m-0 text-base text-muted-foreground sm:text-sm">
                  {catalogStartYear ? `Since ${catalogStartYear}` : "Live and inactive records"}
                </p>
              </div>
              <div className="grid min-w-0">
                <dt className="truncate font-medium text-base text-foreground sm:text-sm">
                  New applications
                </dt>
                <dd className="m-0 truncate font-semibold text-[clamp(1.75rem,2.5vw,2.25rem)] tabular-nums leading-9 tracking-[-0.035em]">
                  {count(newApplicationCount)}
                </dd>
                <p className="m-0 text-base text-muted-foreground sm:text-sm">Last 30 days</p>
              </div>
              <div className="grid min-w-0">
                <dt className="truncate font-medium text-base text-foreground sm:text-sm">
                  Application updates
                </dt>
                <dd className="m-0 truncate font-semibold text-[clamp(1.75rem,2.5vw,2.25rem)] tabular-nums leading-9 tracking-[-0.035em]">
                  {count(applicationUpdateCount)}
                </dd>
                <p className="m-0 text-base text-muted-foreground sm:text-sm">Last 30 days</p>
              </div>
            </dl>
          </section>
          <div className="justify-self-end">
            <LiveBadge />
          </div>
        </div>
      </div>
      <LineChart
        aspectRatio="auto"
        className="h-[clamp(16rem,34vw,28rem)]"
        data={chartData}
        margin={activityChartMargin}
      >
        <Line curve={curveMonotoneX} dataKey="applicationUpdates" fadeEdges={false} />
        <Line
          curve={curveMonotoneX}
          dataKey="newApplications"
          fadeEdges={false}
          stroke="var(--chart-line-secondary)"
        />
        <XAxis edgeInset={48} numTicks={5} showDots />
        <ChartTooltip rows={activityTooltipRows} showDatePill />
      </LineChart>
      <ul className="sr-only list-none">
        {points.map((point) => (
          <li
            aria-label={`${date(point.date)} · ${count(point.newApplications)} new applications · ${count(point.applicationUpdates)} application updates`}
            key={point.date}
          >
            <time dateTime={point.date}>{date(point.date)}</time>: {count(point.newApplications)}{" "}
            new applications, {count(point.applicationUpdates)} application updates
          </li>
        ))}
      </ul>
    </section>
  );
}

function LiveBadge() {
  return (
    <p
      aria-label="Service status: Live"
      className="m-0 inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/8 py-1 pr-2.5 pl-2 font-semibold text-base text-emerald-700 sm:text-sm dark:text-emerald-400"
      role="status"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-emerald-500" />
      Live
    </p>
  );
}
