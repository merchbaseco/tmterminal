import { useQuery } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { AppRouter } from "../../server/src/api/router.ts";
import { MarkResultContent } from "./mark-result-content.tsx";
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
    return "Reports are temporarily unavailable. Check Corpus freshness and try again.";
  }
  return "Report could not be loaded.";
}

function hasIncompleteWindowCoverage(result: ReportResult | undefined, event: ReportEvent) {
  if (!result || event === "published-for-opposition" || !result.to) {
    return false;
  }
  return !result.meta.dataThroughDate || result.meta.dataThroughDate < result.to;
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
  const corpusBuilding = ["SERVICE_UNAVAILABLE", "UPSTREAM_UNAVAILABLE"].includes(
    trpcErrorCode(report.error) ?? ""
  );
  const incompleteWindowCoverage = hasIncompleteWindowCoverage(report.data, state.event);

  useLayoutEffect(() => {
    if (restoredEntry.current === search || !report.data || report.isError) {
      return;
    }
    restoredEntry.current = search;
    window.scrollTo(0, restoreScrollOffset);
  }, [report.data, report.isError, restoreScrollOffset, search]);

  return (
    <main className="report-shell search-shell search-shell-results">
      <header className="report-heading ops-heading">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.heading}</h1>
        </div>
        <p className="ops-intro">
          {report.data && !report.isError
            ? range(report.data.from, report.data.to)
            : "Resolving report window…"}
        </p>
      </header>
      <section aria-label="Report filters" className="search-options report-options">
        <label>
          Status
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
            onChange={(event) => update({ status: event.target.value as ReportState["status"] })}
            value={state.status}
          >
            <option value="all">All</option>
            <option value="live">Live</option>
            <option value="dead">Dead</option>
          </select>
        </label>
        <label>
          Type
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
            onChange={(event) => update({ type: event.target.value as ReportState["type"] })}
            value={state.type}
          >
            <option value="all">All</option>
            <option value="design">Design</option>
            <option value="typeset">Typeset</option>
            <option value="text">Text</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Registered
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
            onChange={(event) =>
              update({ registered: event.target.value as ReportState["registered"] })
            }
            value={state.registered}
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Sort
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Each report filter directly updates URL-owned state.
            onChange={(event) => update({ sort: event.target.value as ReportState["sort"] })}
            value={state.sort}
          >
            <option value="newest-activity">Newest activity</option>
            <option value="oldest-activity">Oldest activity</option>
          </select>
        </label>
      </section>
      {report.isPending ? <p className="search-message">Generating report…</p> : null}
      {report.isError ? (
        <div className="search-error">
          <p className={corpusBuilding ? "search-message" : "error-message"} role="alert">
            {reportErrorMessage(conflict, corpusBuilding)}
          </p>
          {conflict ? (
            <Button onClick={resetReport} variant="outline">
              Run report again
            </Button>
          ) : null}
        </div>
      ) : null}
      {report.data && !report.isError && report.data.total === 0 ? (
        <p className="search-message">
          {incompleteWindowCoverage
            ? "This report window is not fully covered yet. Check Corpus freshness for current coverage."
            : "No marks in this report."}
        </p>
      ) : null}
      {report.data && !report.isError && report.data.total > 0 ? (
        <section aria-label="Report results" className="search-results report-results">
          <div className="results-rule">
            <p>
              {report.data.total} {report.data.total === 1 ? "result" : "results"}
            </p>
            <p>Data through {report.data.meta.dataThroughDate ?? "not yet available"}</p>
          </div>
          <div className="search-results-list">
            {report.data.items.map((item) => (
              <article className="search-result-row" key={item.serialNumber}>
                <MarkResultContent contextLabel={labels.context} item={item} onOpen={onOpenMark} />
              </article>
            ))}
          </div>
          <nav aria-label="Report pages" className="ops-pagination">
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
      <footer className="legal-disclaimer">
        Trademark data is informational, not legal advice. Verify critical decisions with the USPTO
        or qualified counsel.
      </footer>
    </main>
  );
}
