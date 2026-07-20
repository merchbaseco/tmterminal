import { useQuery } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { AppRouter } from "../../server/src/api/router.ts";
import { MarkResultContent } from "./mark-result-content.tsx";
import { SearchOptionSelect } from "./search-option-select.tsx";
import { trpcErrorCode } from "./trpc-error-code.ts";

type ReportInput = inferRouterInputs<AppRouter>["reports"]["run"];
type ReportResult = inferRouterOutputs<AppRouter>["reports"]["run"];
type ReportEvent = ReportInput["event"];

export interface ReportsApi {
  run: (input: ReportInput) => Promise<ReportResult>;
}

interface ReportState {
  event: ReportEvent;
  registered: "all" | "yes" | "no";
  sort: "newest-activity" | "oldest-activity";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "other" | "typeset" | "text";
}

interface ReportPageState {
  dataVersion?: string;
  from?: string;
  offset: number;
  to?: string;
}

const reportLabels: Record<ReportEvent, { context: string; eyebrow: string; heading: string }> = {
  filed: { context: "Filed previous week", eyebrow: "Reports / Previous week", heading: "FILED" },
  "published-for-opposition": {
    context: "Published for opposition",
    eyebrow: "Reports / Current status",
    heading: "PUBLISHED",
  },
  registered: {
    context: "Registered previous week",
    eyebrow: "Reports / Previous week",
    heading: "REGISTERED",
  },
};
const dataVersionPattern = /^\d+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const registeredOptions = [
  { label: "All", value: "all" },
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
] as const;
const sortOptions = [
  { label: "Newest activity", value: "newest-activity" },
  { label: "Oldest activity", value: "oldest-activity" },
] as const;
const statusOptions = [
  { label: "All", value: "all" },
  { label: "Live", value: "live" },
  { label: "Dead", value: "dead" },
] as const;
const typeOptions = [
  { label: "All", value: "all" },
  { label: "Design", value: "design" },
  { label: "Typeset", value: "typeset" },
  { label: "Text", value: "text" },
  { label: "Other", value: "other" },
] as const;

function readState(search: string): ReportState {
  const parameters = new URLSearchParams(search);
  const requestedEvent = parameters.get("event");
  const event: ReportEvent =
    requestedEvent === "registered" || requestedEvent === "published-for-opposition"
      ? requestedEvent
      : "filed";
  const registered = parameters.get("registered");
  const sort = parameters.get("sort");
  const status = parameters.get("status");
  const type = parameters.get("type");
  return {
    event,
    registered: registered === "yes" || registered === "no" ? registered : "all",
    sort: sort === "oldest-activity" ? sort : "newest-activity",
    status: status === "live" || status === "dead" ? status : "all",
    type:
      type === "design" || type === "other" || type === "typeset" || type === "text" ? type : "all",
  };
}

function href(state: ReportState) {
  const parameters = new URLSearchParams({
    event: state.event,
    registered: state.registered,
    sort: state.sort,
    status: state.status,
    type: state.type,
  });
  if (state.event !== "published-for-opposition") {
    parameters.set("window", "previous-week");
  }
  return `/reports?${parameters.toString()}`;
}

function readPageState(search: string, event: ReportEvent): ReportPageState {
  const parameters = new URLSearchParams(search);
  const requestedOffset = Number(parameters.get("offset") ?? 0);
  const offset =
    Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 && requestedOffset % 25 === 0
      ? requestedOffset
      : 0;
  const dataVersion = parameters.get("dataVersion") ?? undefined;
  if (!(dataVersion && dataVersionPattern.test(dataVersion))) {
    return { offset: 0 };
  }
  if (event === "published-for-opposition") {
    return { dataVersion, offset };
  }
  const from = parameters.get("from") ?? undefined;
  const to = parameters.get("to") ?? undefined;
  return from && to && datePattern.test(from) && datePattern.test(to)
    ? { dataVersion, from, offset, to }
    : { offset: 0 };
}

function pageHref(state: ReportState, page: ReportPageState) {
  const [pathname, query = ""] = href(state).split("?");
  const parameters = new URLSearchParams(query);
  parameters.set("dataVersion", page.dataVersion ?? "");
  parameters.set("offset", String(page.offset));
  if (page.from && page.to) {
    parameters.set("from", page.from);
    parameters.set("to", page.to);
  }
  return `${pathname}?${parameters.toString()}`;
}

function request(state: ReportState, page: ReportPageState): ReportInput {
  const { event, ...filters } = state;
  const common = {
    ...filters,
    expectedDataVersion: page.dataVersion,
    limit: 25 as const,
    offset: page.offset,
  };
  if (event === "published-for-opposition") {
    return { ...common, event };
  }
  const window = {
    ...(page.dataVersion ? { expectedFrom: page.from, expectedTo: page.to } : {}),
    window: "previous-week" as const,
  };
  if (event === "registered") {
    return { ...common, ...window, event };
  }
  return { ...common, ...window, event: "filed" };
}

function range(from: string | null, to: string | null) {
  if (!(from && to)) {
    return "Current data status";
  }
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    const month = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(
      start
    );
    return `${month} ${start.getUTCDate()}–${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

function reportErrorMessage(conflict: boolean, unavailable: boolean) {
  if (conflict) {
    return "Trademark data changed. Run the report again before continuing.";
  }
  if (unavailable) {
    return "Reports are temporarily unavailable. Try again shortly.";
  }
  return "Report could not be loaded.";
}

export function ReportsPage({
  api,
  onNavigate,
  onOpenMark,
  restoreScrollOffset,
  search,
}: {
  api: ReportsApi;
  onNavigate: (href: string) => void;
  onOpenMark: (serialNumber: string, scrollOffset: number) => void;
  restoreScrollOffset: number;
  search: string;
}) {
  const state = useMemo(() => readState(search), [search]);
  const page = useMemo(() => readPageState(search, state.event), [search, state.event]);
  const restoredEntry = useRef<string | null>(null);
  const input = useMemo(() => request(state, page), [page, state]);
  const report = useQuery({ queryFn: () => api.run(input), queryKey: ["reports.run", input] });
  const labels = reportLabels[state.event];
  const update = (change: Partial<ReportState>) => onNavigate(href({ ...state, ...change }));
  const resetReport = useCallback(() => onNavigate(href(state)), [onNavigate, state]);
  const conflict = trpcErrorCode(report.error) === "CONFLICT";
  const temporarilyUnavailable = ["SERVICE_UNAVAILABLE", "UPSTREAM_UNAVAILABLE"].includes(
    trpcErrorCode(report.error) ?? ""
  );

  useLayoutEffect(() => {
    if (restoredEntry.current === search || !report.data || report.isError) {
      return;
    }
    restoredEntry.current = search;
    window.scrollTo(0, restoreScrollOffset);
  }, [report.data, report.isError, restoreScrollOffset, search]);

  return (
    <main className="page-shell isolate flex min-h-[calc(100dvh-3.75rem)] flex-col pt-4">
      <header className="grid grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] items-end gap-8 border-border border-b pb-[clamp(1.5rem,3vw,2.5rem)] max-[48rem]:grid-cols-1 max-[48rem]:items-start">
        <div>
          <p className="mb-[0.85rem] font-[650] text-[0.75rem] uppercase tracking-[0.1em]">
            {labels.eyebrow}
          </p>
          <h1 className="m-0 font-black text-[clamp(4.75rem,13vw,13rem)] leading-[0.78] tracking-[-0.055em]">
            {labels.heading}
          </h1>
        </div>
        <p className="m-0 max-w-[29rem] text-base">
          {report.data && !report.isError
            ? range(report.data.from, report.data.to)
            : "Resolving report window…"}
        </p>
      </header>
      <section
        aria-label="Report filters"
        className="mt-[clamp(1.5rem,4vw,3rem)] flex flex-wrap items-end border-border border-y max-[48rem]:grid max-[48rem]:grid-cols-2 max-[48rem]:items-stretch"
      >
        <SearchOptionSelect
          label="Status"
          name="status"
          // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
          onValueChange={(status) => update({ status })}
          options={statusOptions}
          value={state.status}
        />
        <SearchOptionSelect
          label="Type"
          name="type"
          // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
          onValueChange={(type) => update({ type })}
          options={typeOptions}
          value={state.type}
        />
        <SearchOptionSelect
          label="Registered"
          name="registered"
          // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
          onValueChange={(registered) => update({ registered })}
          options={registeredOptions}
          value={state.registered}
        />
        <SearchOptionSelect
          label="Sort"
          name="sort"
          // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
          onValueChange={(sort) => update({ sort })}
          options={sortOptions}
          value={state.sort}
        />
      </section>
      {report.isPending ? (
        <p className="m-0 border-border border-b py-12 text-base">Generating report…</p>
      ) : null}
      {report.isError ? (
        <div className="flex items-center justify-between gap-4 border-border border-b">
          <p
            className={
              temporarilyUnavailable
                ? "m-0 py-12 text-base"
                : "m-0 py-8 text-destructive-foreground"
            }
            role="alert"
          >
            {reportErrorMessage(conflict, temporarilyUnavailable)}
          </p>
          {conflict ? (
            <Button onClick={resetReport} variant="outline">
              Run report again
            </Button>
          ) : null}
        </div>
      ) : null}
      {report.data && !report.isError && report.data.total === 0 ? (
        <p className="m-0 border-border border-b py-12 text-base">No marks in this report.</p>
      ) : null}
      {report.data && !report.isError && report.data.total > 0 ? (
        <section aria-label="Report results">
          <div className="flex min-h-10 items-center font-[650] text-[0.75rem] uppercase tracking-[0.09em] [&_p]:m-0">
            <p>
              {report.data.total} {report.data.total === 1 ? "result" : "results"}
            </p>
          </div>
          <div className="border-border border-y">
            {report.data.items.map((item) => (
              <article
                className="relative isolate grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-8 border-border border-b py-2 has-[a:hover]:bg-accent max-[48rem]:min-h-20 max-[48rem]:gap-4 max-[48rem]:py-2.5"
                key={item.serialNumber}
              >
                <MarkResultContent contextLabel={labels.context} item={item} onOpen={onOpenMark} />
              </article>
            ))}
          </div>
          <nav
            aria-label="Report pages"
            className="flex items-center justify-end gap-4 pt-4 [&_p]:m-0"
          >
            <Button
              disabled={report.isFetching || page.offset === 0}
              // biome-ignore lint/performance/noJsxPropsBind: Pagination advances this report's pinned data page.
              onClick={() =>
                onNavigate(
                  pageHref(state, {
                    dataVersion: report.data.meta.dataVersion,
                    from: report.data.from ?? undefined,
                    offset: Math.max(0, page.offset - 25),
                    to: report.data.to ?? undefined,
                  })
                )
              }
              variant="outline"
            >
              Previous
            </Button>
            <p>
              {page.offset + 1}–{Math.min(page.offset + 25, report.data.total)} of{" "}
              {report.data.total}
            </p>
            <Button
              disabled={report.isFetching || page.offset + 25 >= report.data.total}
              // biome-ignore lint/performance/noJsxPropsBind: Pagination advances this report's pinned data page.
              onClick={() =>
                onNavigate(
                  pageHref(state, {
                    dataVersion: report.data.meta.dataVersion,
                    from: report.data.from ?? undefined,
                    offset: page.offset + 25,
                    to: report.data.to ?? undefined,
                  })
                )
              }
              variant="outline"
            >
              Next
            </Button>
          </nav>
        </section>
      ) : null}
      <footer className="relative left-1/2 mt-auto w-dvw -translate-x-1/2 border-border border-t text-muted-foreground/70">
        <p className="page-shell my-0 py-8">
          Trademark data is informational, not legal advice. Verify critical decisions with the
          USPTO or qualified counsel.
        </p>
      </footer>
    </main>
  );
}
