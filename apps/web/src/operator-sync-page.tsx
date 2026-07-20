import { Tooltip } from "@base-ui/react/tooltip";
import type { inferRouterOutputs } from "@trpc/server";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PublicSourceStatus } from "../../server/src/api/contracts.ts";
import type { AppRouter } from "../../server/src/api/router.ts";

type Outputs = inferRouterOutputs<AppRouter>["ops"]["sync"];
type Artifact = Outputs["artifacts"]["items"][number];
type AttentionItem = Outputs["status"]["attention"]["items"][number];

interface PageInput {
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
const mobileTickClasses = [undefined, "text-center", "text-right"];
const count = (value: number) => new Intl.NumberFormat().format(value);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`)
      )
    : "No files yet";
const shortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
const timestamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value)
      )
    : "—";

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
  if (artifact.projectionState === "complete") {
    return {
      label: artifact.storageState === "cleaned-up" ? "Complete · Cleaned up" : "Complete",
      tone: "text-foreground",
    };
  }
  if (
    artifact.downloadState === "failed" ||
    artifact.downloadState === "unavailable" ||
    artifact.projectionState === "failed"
  ) {
    return { label: "Needs attention", tone: "text-destructive-foreground" };
  }
  if (artifact.projectionState === "projecting") {
    return { label: "Processing", tone: "text-primary" };
  }
  if (artifact.downloadState === "downloading") {
    return { label: "Downloading", tone: "text-primary" };
  }
  return { label: "Waiting", tone: "text-muted-foreground" };
}

function attentionMessage(item: AttentionItem) {
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
  const [error, setError] = useState<"load" | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const pagePending = useRef(false);

  useEffect(() => {
    let active = true;
    const request = operatorApi
      ? Promise.all([operatorApi.status(), operatorApi.artifacts({ limit, offset: 0 })]).then(
          ([nextStatus, nextArtifacts]) => ({ nextArtifacts, nextStatus })
        )
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
    setPageError(false);
    try {
      if (!operatorApi) {
        return;
      }
      const page = await operatorApi.artifacts({ limit, offset: artifacts.items.length });
      setArtifacts((current) =>
        current ? { ...page, items: [...current.items, ...page.items], offset: 0 } : page
      );
    } catch {
      setPageError(true);
    } finally {
      pagePending.current = false;
      setPageLoading(false);
    }
  }, [artifacts, operatorApi]);

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
      className="page-shell isolate min-h-[calc(100dvh-3.75rem)] pt-[clamp(1.25rem,3vw,2.5rem)] pb-[clamp(2rem,5vw,5.5rem)]"
    >
      {error === "load" ? (
        <p className="m-0 py-8 text-destructive-foreground" role="alert">
          Status could not be loaded.
        </p>
      ) : null}
      {status || error ? null : <p className="m-0 py-8">Loading status…</p>}
      {status ? (
        <>
          <header>
            <p className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]">
              Status / Latest processed
            </p>
            <h1 className="mt-3 mb-0 font-black text-[clamp(3rem,7.5vw,8rem)] leading-[0.78] tracking-[-0.055em] min-[48rem]:whitespace-nowrap">
              {date(status.source.latestProcessedDate)}
            </h1>
            <p className="mt-4 mb-0 max-w-[52rem] font-[550] text-base text-muted-foreground">
              USPTO trademark XML source files are processed as they publish. Search always uses the
              newest processed data.
            </p>
          </header>
          {status.source.currentArtifact ? (
            <p className="mt-6 mb-0 border-border border-y py-3 text-muted-foreground">
              {status.source.currentArtifact.state === "processing" ? "Processing" : "Downloading"}{" "}
              <strong className="text-foreground">{status.source.currentArtifact.filename}</strong>.
              Processed data remains searchable.
            </p>
          ) : null}
          <ProcessingActivity status={status} />
          <ActivityStats status={status} />
          <AboutStatus />
          {operatorStatus ? <Attention status={operatorStatus} /> : null}
        </>
      ) : null}
      {artifacts ? (
        <SourceFiles
          artifacts={artifacts}
          hasMore={hasMore}
          loadMore={loadMore}
          loadMoreRef={loadMoreRef}
          pageError={pageError}
          pageLoading={pageLoading}
        />
      ) : null}
    </main>
  );
}

function AboutStatus() {
  return (
    <section className="mt-[clamp(2.5rem,5vw,4.5rem)] border-border border-t pt-3">
      <h2 className="m-0 font-bold text-base">About this data</h2>
      <p className="mt-3 mb-0 max-w-[52rem] text-muted-foreground">
        Trademark Turtle processes official USPTO trademark records for International Class 025.
        Learn how search modes, statuses, mark types, and reports work on the{" "}
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
  hasMore,
  loadMore,
  loadMoreRef,
  pageError,
  pageLoading,
}: {
  artifacts: Outputs["artifacts"];
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  pageError: boolean;
  pageLoading: boolean;
}) {
  return (
    <section aria-busy={pageLoading} className="mt-[clamp(2.5rem,5vw,4.5rem)]">
      <div className="flex items-baseline justify-between gap-4 border-border border-t pt-3 max-[48rem]:grid max-[48rem]:gap-1">
        <h2 className="m-0 font-bold text-base">Source files</h2>
        <p className="m-0 text-muted-foreground">{artifacts.total} files</p>
      </div>
      <ol aria-label="Source files" className="m-0 list-none p-0">
        {artifacts.items.map((artifact) => {
          const state = artifactState(artifact);
          return (
            <li
              className="grid grid-cols-[minmax(16rem,1.5fr)_minmax(10rem,0.7fr)_minmax(9rem,0.65fr)_auto] items-center gap-6 border-border border-b py-3 max-[60rem]:grid-cols-[minmax(0,1fr)_auto] max-[60rem]:gap-x-4 max-[60rem]:gap-y-1"
              key={artifact.artifactId}
            >
              <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {artifact.filename}
              </strong>
              <span className={state.tone}>{state.label}</span>
              <span className="text-muted-foreground tabular-nums max-[60rem]:col-start-1">
                {count(artifact.physicalRecordCount)} records → {count(artifact.projectedMarkCount)}{" "}
                marks
              </span>
              <time
                className="text-right text-muted-foreground"
                dateTime={artifact.updatedAt}
                title={timestamp(artifact.updatedAt)}
              >
                {relativeTimestamp(artifact.updatedAt)}
              </time>
            </li>
          );
        })}
      </ol>
      {pageLoading ? (
        <p className="m-0 border-border border-b py-8 text-muted-foreground" role="status">
          Loading more source files…
        </p>
      ) : null}
      {pageError ? (
        <div className="flex items-center justify-between gap-4 border-border border-b py-4">
          <p className="m-0 text-destructive-foreground" role="alert">
            More source files could not be loaded.
          </p>
          <Button onClick={loadMore} variant="outline">
            Try again
          </Button>
        </div>
      ) : null}
      {!(pageLoading || pageError) && artifacts.total > limit && !hasMore ? (
        <p className="m-0 border-border border-b py-4 text-muted-foreground">
          All {artifacts.total} source files shown.
        </p>
      ) : null}
      <div aria-hidden="true" className="h-px" ref={loadMoreRef} />
    </section>
  );
}

function Attention({ status }: { status: Outputs["status"] }) {
  const providerStopped = status.provider.status === "stopped";
  const total = status.attention.total + (providerStopped ? 1 : 0);
  return (
    <section
      aria-labelledby="attention-heading"
      className="mt-[clamp(2.5rem,5vw,4.5rem)]"
      id="needs-attention"
    >
      <div className="flex items-baseline justify-between gap-4 border-border border-t pt-3">
        <h2 className="m-0 font-bold text-base" id="attention-heading">
          Needs attention
        </h2>
        <p className="m-0 text-muted-foreground">{total}</p>
      </div>
      {total === 0 ? (
        <p className="m-0 border-border border-b py-4 text-muted-foreground">
          Nothing needs attention.
        </p>
      ) : (
        <ul className="mt-4 mb-0 grid list-none gap-3 p-0">
          {status.attention.items.map((item) => (
            <li
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border border-foreground p-4"
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
          {providerStopped ? (
            <li className="grid gap-1 border border-foreground p-4">
              <strong>USPTO connection stopped</strong>
              <p className="m-0 text-destructive-foreground">
                Source downloads have stopped and need operator attention.
              </p>
            </li>
          ) : null}
        </ul>
      )}
      {status.attention.total > status.attention.items.length ? (
        <p className="mt-3 mb-0 text-muted-foreground">
          {status.attention.total - status.attention.items.length} more source files need attention.
        </p>
      ) : null}
    </section>
  );
}

function ActivityStats({ status }: { status: PublicSourceStatus }) {
  const recentRecordCount = status.source.processingActivity.reduce(
    (total, point) => total + point.count,
    0
  );
  return (
    <section aria-label="Trademark catalog" className="@container mt-[clamp(2rem,4vw,3.5rem)]">
      <dl className="m-0 grid @max-[60rem]:grid-cols-2 grid-cols-4 gap-px border-border border-y bg-border">
        <div className="bg-background px-4 py-4">
          <dt className="truncate font-[650] text-[0.75rem] text-muted-foreground uppercase tracking-[0.1em]">
            Total trademarks
          </dt>
          <dd className="m-0 mt-2 font-extrabold text-[clamp(1.5rem,2.5vw,2.25rem)] tabular-nums leading-none">
            {count(status.catalog.totalMarkCount)}
          </dd>
        </div>
        <div className="bg-background px-4 py-4">
          <dt className="truncate font-[650] text-[0.75rem] text-muted-foreground uppercase tracking-[0.1em]">
            Live
          </dt>
          <dd className="m-0 mt-2 font-extrabold text-[clamp(1.5rem,2.5vw,2.25rem)] tabular-nums leading-none">
            {count(status.catalog.liveMarkCount)}
          </dd>
        </div>
        <div className="bg-background px-4 py-4">
          <dt className="truncate font-[650] text-[0.75rem] text-muted-foreground uppercase tracking-[0.1em]">
            Registered
          </dt>
          <dd className="m-0 mt-2 font-extrabold text-[clamp(1.5rem,2.5vw,2.25rem)] tabular-nums leading-none">
            {count(status.catalog.registeredMarkCount)}
          </dd>
        </div>
        <div className="bg-background px-4 py-4">
          <dt className="truncate font-[650] text-[0.75rem] text-muted-foreground uppercase tracking-[0.1em]">
            Records · 30 days
          </dt>
          <dd className="m-0 mt-2 font-extrabold text-[clamp(1.5rem,2.5vw,2.25rem)] tabular-nums leading-none">
            {count(recentRecordCount)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ProcessingActivity({ status }: { status: PublicSourceStatus }) {
  const points = status.source.processingActivity;
  const [firstPoint] = points;
  if (!firstPoint) {
    return null;
  }
  const lastPoint = points.at(-1) ?? firstPoint;
  const maximum = Math.max(...points.map((point) => point.count), 1);
  const desktopTicks = points.filter((_, index) => index % 7 === 0);
  const mobileTicks = [firstPoint, points[Math.floor(points.length / 2)], lastPoint].filter(
    (point): point is (typeof points)[number] => Boolean(point)
  );
  const period = `${shortDate(firstPoint.date)} – ${date(lastPoint.date)}`;
  return (
    <section
      aria-labelledby="processing-activity-heading"
      className="mt-[clamp(2.5rem,5vw,4.5rem)] border-border border-t pt-3"
    >
      <div className="flex items-start justify-between gap-6 max-[48rem]:grid max-[48rem]:gap-1">
        <div>
          <h2 className="m-0 font-bold text-base" id="processing-activity-heading">
            Records processed
          </h2>
          <p className="mt-1 mb-0 text-muted-foreground">
            USPTO source records processed by Trademark Turtle each day
          </p>
        </div>
        <p className="m-0 whitespace-nowrap text-right text-muted-foreground max-[48rem]:text-left">
          Past 30 days · {period}
        </p>
      </div>
      <Tooltip.Provider delay={120}>
        <div className="mt-6 grid h-[8rem] auto-cols-fr grid-flow-col items-end gap-[clamp(2px,0.3vw,6px)] border-border border-b max-[48rem]:h-[6rem]">
          {points.map((point) => {
            const pointValue = `${count(point.count)} records`;
            const pointLabel = `${date(point.date)} · ${pointValue}`;
            return (
              <Tooltip.Root key={point.date}>
                <Tooltip.Trigger
                  aria-label={pointLabel}
                  className="group flex h-full min-w-0 cursor-default items-end justify-center rounded-none outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                >
                  <span
                    className="w-full min-w-px bg-foreground transition-colors group-hover:bg-primary group-focus-visible:bg-primary"
                    style={{ height: `${(point.count / maximum) * 100}%` }}
                  />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner side="top" sideOffset={8}>
                    <Tooltip.Popup className="z-50 whitespace-nowrap rounded-sm bg-foreground px-2.5 py-1.5 text-background text-base tabular-nums">
                      {pointLabel}
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </div>
      </Tooltip.Provider>
      <div className="mt-2 grid auto-cols-fr grid-flow-col text-base text-muted-foreground tabular-nums max-[48rem]:hidden">
        {desktopTicks.map((point, index) => (
          <time
            className={index === desktopTicks.length - 1 ? "text-right" : undefined}
            dateTime={point.date}
            key={point.date}
          >
            {shortDate(point.date)}
          </time>
        ))}
      </div>
      <div className="mt-2 hidden grid-cols-3 text-base text-muted-foreground tabular-nums max-[48rem]:grid">
        {mobileTicks.map((point, index) => (
          <time className={mobileTickClasses[index]} dateTime={point.date} key={point.date}>
            {shortDate(point.date)}
          </time>
        ))}
      </div>
    </section>
  );
}
