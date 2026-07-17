import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AppRouter } from "../../server/src/api/router.ts";

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
function isForbidden(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "data" in error &&
      error.data &&
      typeof error.data === "object" &&
      "code" in error.data &&
      error.data.code === "FORBIDDEN"
  );
}

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
          setError(isForbidden(cause) ? "forbidden" : "load");
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
  return (
    <main aria-busy={!(status || error)} className="ops-shell">
      <header className="ops-heading">
        <div>
          <p className="eyebrow">Operations / sync</p>
          <h1>CORPUS</h1>
        </div>
        <p className="ops-intro">Direct annual corpus generation state.</p>
      </header>
      {error === "load" ? (
        <p className="error-message" role="alert">
          Sync operations could not be loaded.
        </p>
      ) : null}
      {status || error ? null : <p className="empty-row">Loading durable sync state…</p>}
      {status ? (
        <section aria-label="Annual generation status" className="dataset-grid">
          <article className="dataset-summary">
            <header>
              <p>Annual archive</p>
              <h2>TRTYRAP</h2>
            </header>
            <p className={`stage-label stage-${status.summary.activeState}`}>
              {status.summary.activeState}
            </p>
            <dl className="dataset-facts tabular-nums">
              <div>
                <dt>Artifacts</dt>
                <dd>
                  {status.generation.completeArtifactCount} of{" "}
                  {status.generation.expectedArtifactCount} complete
                </dd>
              </div>
              <div>
                <dt>Projected marks</dt>
                <dd>{count(status.generation.projectedMarkCount)}</dd>
              </div>
              <div>
                <dt>Failed artifacts</dt>
                <dd>{status.generation.failedArtifactCount}</dd>
              </div>
              <div>
                <dt>Complete frontier</dt>
                <dd>{date(status.summary.completeThroughDate)}</dd>
              </div>
              <div>
                <dt>Corpus version</dt>
                <dd>{status.summary.corpusVersion}</dd>
              </div>
              <div>
                <dt>Last activation</dt>
                <dd>{timestamp(status.summary.lastSuccessfulMergeAt)}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{status.provider.status}</dd>
              </div>
              <div>
                <dt>Provider failures</dt>
                <dd>{status.provider.failureCount}</dd>
              </div>
              <div>
                <dt>Next eligible</dt>
                <dd>{timestamp(status.provider.nextEligibleAt)}</dd>
              </div>
              <div>
                <dt>Current error</dt>
                <dd>{status.provider.currentError ?? "—"}</dd>
              </div>
            </dl>
          </article>
        </section>
      ) : null}
      {artifacts ? (
        <section className="ops-section">
          <div className="ops-section-heading">
            <div>
              <p className="eyebrow">Bounded source state</p>
              <h2>Annual artifacts</h2>
            </div>
            <p>{artifacts.total} total</p>
          </div>
          <div className="ops-table-scroll">
            <div>
              <table>
                <thead>
                  <tr>
                    <th>Artifact</th>
                    <th>State</th>
                    <th>Records</th>
                    <th>Marks</th>
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
                        <code>{artifact.sha256?.slice(0, 12) ?? "not downloaded"}</code>
                      </td>
                      <td>{artifact.state}</td>
                      <td className="tabular-nums">{count(artifact.physicalRecordCount)}</td>
                      <td className="tabular-nums">{count(artifact.projectedMarkCount)}</td>
                      <td>
                        {date(artifact.sourceFromDate)} — {date(artifact.sourceToDate)}
                      </td>
                      <td>{timestamp(artifact.updatedAt)}</td>
                      <td>{artifact.currentError ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {pageError ? (
            <p className="error-message" role="alert">
              Artifact page could not be loaded; the previous page remains shown.
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
    </main>
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
