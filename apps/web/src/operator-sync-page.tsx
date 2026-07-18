import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
      <main className="ops-shell">
        <p className="eyebrow">Operations / sync</p>
        <h1>ACCESS DENIED</h1>
        <p className="ops-intro" role="alert">
          This page requires the server-side operator role.
        </p>
      </main>
    );
  }
  const copy = optionalCopy(status);
  return (
    <main aria-busy={!(status || error)} className="ops-shell">
      <p className="eyebrow">Operations / sync</p>
      {error === "load" ? (
        <p className="error-message" role="alert">
          Sync operations could not be loaded.
        </p>
      ) : null}
      {status || error ? null : <p className="empty-row">Loading sync status…</p>}
      {status && copy ? (
        <>
          <header className={`ops-status stage-${status.summary.activeState}`}>
            <h1>{copy.headline}</h1>
            <p className="ops-status-description">{copy.description}</p>
          </header>
          <section aria-label="Corpus sync status" className="ops-summary">
            <dl className="ops-stats tabular-nums">
              <div className="ops-stat">
                <dt>Marks processed</dt>
                <dd>{count(status.source.projectedMarkCount)}</dd>
              </div>
              <div className="ops-stat">
                <dt>Source records processed</dt>
                <dd>{count(status.source.physicalRecordCount)}</dd>
              </div>
              <div className="ops-stat">
                <dt>Complete through</dt>
                <dd>{date(status.summary.completeThroughDate)}</dd>
              </div>
              <div className="ops-stat">
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
              <div className="ops-stat">
                <dt>Sync issues</dt>
                <dd>{status.annualBaseline.failedArtifactCount}</dd>
              </div>
              <div className="ops-stat">
                <dt>USPTO connection</dt>
                <dd>{providerLabels[status.provider.status]}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : null}
      {artifacts ? (
        <section className="ops-table-section">
          <div className="ops-section-heading">
            <h2>Source files</h2>
            <p>{artifacts.total} files · read-only</p>
          </div>
          <div className="ops-table-scroll">
            <div>
              <table aria-label="Source files">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>State</th>
                    <th className="numeric-column">Records</th>
                    <th className="numeric-column">Marks</th>
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
                        <span className={`artifact-state state-${artifact.state}`}>
                          <span aria-hidden="true" />
                          {artifactStateLabels[artifact.state]}
                        </span>
                      </td>
                      <td className="numeric-column tabular-nums">
                        {count(artifact.physicalRecordCount)}
                      </td>
                      <td className="numeric-column tabular-nums">
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
                        className={artifact.currentError ? "artifact-error" : undefined}
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
            <p className="error-message" role="alert">
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
    <section className="ops-table-section ops-system-details">
      <div className="ops-section-heading">
        <h2>System details</h2>
        <p>Corpus and provider state</p>
      </div>
      <table aria-label="System details" className="ops-facts-table tabular-nums">
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
              <td className="artifact-error">{status.provider.currentError}</td>
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
    <nav aria-label="Pagination" className="ops-pagination">
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
