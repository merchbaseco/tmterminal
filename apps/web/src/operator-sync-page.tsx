import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";

import type { AppRouter } from "../../server/src/api/router.ts";
import { Button } from "@/components/ui/button";

type Outputs = inferRouterOutputs<AppRouter>["ops"]["sync"];
type PageInput = { limit: number; offset: number; product?: "TRTDXFAP" | "TRTYRAP" };

export type OperatorSyncApi = {
  artifacts(input: PageInput): Promise<Outputs["artifacts"]>;
  artifactVersions(input: PageInput): Promise<Outputs["artifact-versions"]>;
  publications(input: Omit<PageInput, "product">): Promise<Outputs["publications"]>;
  rejects(input: PageInput): Promise<Outputs["rejects"]>;
  status(): Promise<Outputs["status"]>;
};

const limit = 25;

function timestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function isForbidden(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  return Boolean(data && typeof data === "object" && "code" in data && data.code === "FORBIDDEN");
}

export function OperatorSyncPage({ api }: { api: OperatorSyncApi }) {
  const [status, setStatus] = useState<Outputs["status"] | null>(null);
  const [artifacts, setArtifacts] = useState<Outputs["artifacts"] | null>(null);
  const [artifactVersions, setArtifactVersions] = useState<Outputs["artifact-versions"] | null>(null);
  const [publications, setPublications] = useState<Outputs["publications"] | null>(null);
  const [rejects, setRejects] = useState<Outputs["rejects"] | null>(null);
  const [error, setError] = useState<"forbidden" | "load" | null>(null);
  const [artifactPageLoading, setArtifactPageLoading] = useState(false);
  const [artifactPageError, setArtifactPageError] = useState(false);
  const [versionPageLoading, setVersionPageLoading] = useState(false);
  const [versionPageError, setVersionPageError] = useState(false);
  const [publicationPageLoading, setPublicationPageLoading] = useState(false);
  const [publicationPageError, setPublicationPageError] = useState(false);
  const [rejectPageLoading, setRejectPageLoading] = useState(false);
  const [rejectPageError, setRejectPageError] = useState(false);
  const artifactPagePending = useRef(false);
  const versionPagePending = useRef(false);
  const publicationPagePending = useRef(false);
  const rejectPagePending = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.status(),
      api.artifacts({ limit, offset: 0 }),
      api.artifactVersions({ limit, offset: 0 }),
      api.publications({ limit, offset: 0 }),
      api.rejects({ limit, offset: 0 }),
    ]).then(([nextStatus, nextArtifacts, nextVersions, nextPublications, nextRejects]) => {
      if (!active) return;
      setStatus(nextStatus);
      setArtifacts(nextArtifacts);
      setArtifactVersions(nextVersions);
      setPublications(nextPublications);
      setRejects(nextRejects);
    }).catch((cause: unknown) => {
      if (active) setError(isForbidden(cause) ? "forbidden" : "load");
    });
    return () => { active = false; };
  }, [api]);

  async function loadArtifactPage(offset: number) {
    if (artifactPagePending.current) return;
    artifactPagePending.current = true;
    setArtifactPageLoading(true);
    setArtifactPageError(false);
    try {
      setArtifacts(await api.artifacts({ limit, offset }));
    } catch {
      setArtifactPageError(true);
    } finally {
      artifactPagePending.current = false;
      setArtifactPageLoading(false);
    }
  }

  async function loadVersionPage(offset: number) {
    if (versionPagePending.current) return;
    versionPagePending.current = true;
    setVersionPageLoading(true);
    setVersionPageError(false);
    try {
      setArtifactVersions(await api.artifactVersions({ limit, offset }));
    } catch {
      setVersionPageError(true);
    } finally {
      versionPagePending.current = false;
      setVersionPageLoading(false);
    }
  }

  async function loadPublicationPage(offset: number) {
    if (publicationPagePending.current) return;
    publicationPagePending.current = true;
    setPublicationPageLoading(true);
    setPublicationPageError(false);
    try {
      setPublications(await api.publications({ limit, offset }));
    } catch {
      setPublicationPageError(true);
    } finally {
      publicationPagePending.current = false;
      setPublicationPageLoading(false);
    }
  }

  async function loadRejectPage(offset: number) {
    if (rejectPagePending.current) return;
    rejectPagePending.current = true;
    setRejectPageLoading(true);
    setRejectPageError(false);
    try {
      setRejects(await api.rejects({ limit, offset }));
    } catch {
      setRejectPageError(true);
    } finally {
      rejectPagePending.current = false;
      setRejectPageLoading(false);
    }
  }

  if (error === "forbidden") {
    return <main className="ops-shell"><p className="eyebrow">Operations / sync</p><h1>ACCESS DENIED</h1><p className="ops-intro" role="alert">This page requires the server-side operator role.</p></main>;
  }

  return (
    <main aria-busy={!status && !error} className="ops-shell">
      <header className="ops-heading">
        <div><p className="eyebrow">Operations / sync</p><h1>CORPUS</h1></div>
        <p className="ops-intro">Durable ingestion state for the annual archive and daily updates.</p>
      </header>
      {error === "load" ? <p className="error-message" role="alert">Sync operations could not be loaded.</p> : null}
      {!status && !error ? <p className="empty-row">Loading durable sync state…</p> : null}

      {status ? (
        <section aria-label="Dataset status" className="dataset-grid">
          {status.datasets.map((dataset) => (
            <article className="dataset-summary" key={dataset.product}>
              <header><p>{dataset.product === "TRTYRAP" ? "Annual archive" : "Daily updates"}</p><h2>{dataset.product}</h2></header>
              <p className={`stage-label stage-${dataset.currentStage}`}>{dataset.currentStage}</p>
              {dataset.reason ? <p className="dataset-reason">{dataset.reason}</p> : null}
              <dl className="dataset-facts tabular-nums">
                <div><dt>Coverage</dt><dd>{date(dataset.coverageFromDate)} — {date(dataset.coverageThroughDate)}</dd></div>
                <div><dt>Complete frontier</dt><dd>{date(dataset.completeThroughDate)}</dd></div>
                <div><dt>Stage since</dt><dd>{timestamp(dataset.stageSince)}</dd></div>
                <div><dt>Latest activity</dt><dd>{timestamp(dataset.latestSuccessfulActivityAt)}</dd></div>
                <div><dt>Latest publication</dt><dd>{timestamp(dataset.latestPublicationAt)}</dd></div>
                <div><dt>Backlog</dt><dd>{dataset.backlogCount}</dd></div>
                <div><dt>Provider backoff</dt><dd>{timestamp(dataset.providerBackoffUntil)}</dd></div>
                <div><dt>Provider stopped</dt><dd>{dataset.providerStopReason ?? "—"}</dd></div>
                <div><dt>Diagnostics</dt><dd>{dataset.failedCount} failed · {dataset.rejectCount} rejected · {dataset.quarantineCount} quarantined</dd></div>
              </dl>
            </article>
          ))}
        </section>
      ) : null}

      {artifacts ? (
        <section className="ops-section">
          <div className="ops-section-heading"><div><p className="eyebrow">Bounded diagnostic read</p><h2>Recent artifacts</h2></div><p>{artifacts.total} total</p></div>
          <div className="ops-table-scroll"><div><table><thead><tr><th>Artifact</th><th>Product</th><th>Stage</th><th>Selected version</th><th>Coverage</th><th>Since</th><th>Diagnostic</th></tr></thead><tbody>
            {artifacts.items.map((artifact) => <tr key={artifact.artifactId}>
              <td><strong>{artifact.filename}</strong><code>{artifact.sha256?.slice(0, 12) ?? "not retained"}</code></td>
              <td>{artifact.product}</td><td>{artifact.selectionRequired ? "selection required" : artifact.stage}</td>
              <td>{artifact.selectedSha256?.slice(0, 12) ?? "—"} · {artifact.retainedVersionCount} retained</td>
              <td>{date(artifact.sourceFromDate)} — {date(artifact.sourceToDate)}</td><td>{timestamp(artifact.stageSince)}</td>
              <td>{artifact.quarantineReason ?? artifact.lastErrorCode ?? "—"}</td>
            </tr>)}
          </tbody></table></div></div>
          {artifactPageError ? <p className="error-message" role="alert">Artifact page could not be loaded; the previous page remains shown.</p> : null}
          <Pagination loading={artifactPageLoading} offset={artifacts.offset} total={artifacts.total} onPage={(offset) => void loadArtifactPage(offset)} />
        </section>
      ) : null}

      {artifactVersions ? (
        <section className="ops-section">
          <div className="ops-section-heading"><div><p className="eyebrow">Bounded retained provenance</p><h2>Artifact versions</h2></div><p>{artifactVersions.total} total</p></div>
          <div className="ops-table-scroll"><div><table><thead><tr><th>Artifact</th><th>Version ID</th><th>SHA-256</th><th>State</th><th>Parser</th><th>Coverage</th><th>Retained</th><th>Diagnostic</th></tr></thead><tbody>
            {artifactVersions.items.map((version) => <tr key={version.artifactVersionId}>
              <td><strong>{version.filename}</strong><code>{version.artifactId}</code></td>
              <td><code>{version.artifactVersionId}</code></td>
              <td><code>{version.sha256}</code></td>
              <td>{version.selected ? `selected · ${version.state}` : version.state}</td>
              <td>{version.parserVersion ? `${version.parserVersion} · ${version.parseState}` : "not parsed"}</td>
              <td>{date(version.sourceFromDate)} — {date(version.sourceToDate)}</td>
              <td>{timestamp(version.createdAt)}</td>
              <td>{version.quarantineReason ?? "—"}</td>
            </tr>)}
          </tbody></table></div></div>
          {versionPageError ? <p className="error-message" role="alert">Artifact version page could not be loaded; the previous page remains shown.</p> : null}
          <Pagination loading={versionPageLoading} offset={artifactVersions.offset} total={artifactVersions.total} onPage={(offset) => void loadVersionPage(offset)} />
        </section>
      ) : null}

      {publications ? (
        <section className="ops-section">
          <div className="ops-section-heading"><div><p className="eyebrow">Bounded diagnostic read</p><h2>Recent publications</h2></div><p>{publications.total} total</p></div>
          <div className="ops-table-scroll"><div><table><thead><tr><th>Publication</th><th>State</th><th>Artifacts</th><th>Corpus version</th><th>Complete through</th><th>Created</th><th>Diagnostics</th></tr></thead><tbody>
            {publications.items.map((publication) => <tr key={publication.id}><td><code>{publication.id.slice(0, 12)}</code></td><td>{publication.state}</td><td>{publication.artifactCount}</td><td>{publication.corpusVersion ?? "—"}</td><td>{date(publication.completeThroughDate)}</td><td>{timestamp(publication.createdAt)}</td><td>{publication.diagnosticCount}</td></tr>)}
          </tbody></table></div></div>
          {publicationPageError ? <p className="error-message" role="alert">Publication page could not be loaded; the previous page remains shown.</p> : null}
          <Pagination loading={publicationPageLoading} offset={publications.offset} total={publications.total} onPage={(offset) => void loadPublicationPage(offset)} />
        </section>
      ) : null}

      {rejects ? (
        <section className="ops-section">
          <div className="ops-section-heading"><div><p className="eyebrow">Bounded diagnostic read</p><h2>Recent rejections</h2></div><p>{rejects.total} total</p></div>
          <div className="ops-table-scroll"><div><table><thead><tr><th>Artifact</th><th>Product</th><th>Kind</th><th>Record</th><th>Reason</th><th>Created</th></tr></thead><tbody>
            {rejects.items.map((reject) => <tr key={reject.id}><td>{reject.filename ?? "Publication"}</td><td>{reject.product ?? "—"}</td><td>{reject.kind}</td><td>{reject.physicalRecordIndex ?? reject.serialNumber ?? "—"}</td><td>{reject.reason}</td><td>{timestamp(reject.createdAt)}</td></tr>)}
          </tbody></table></div></div>
          {rejectPageError ? <p className="error-message" role="alert">Rejection page could not be loaded; the previous page remains shown.</p> : null}
          <Pagination loading={rejectPageLoading} offset={rejects.offset} total={rejects.total} onPage={(offset) => void loadRejectPage(offset)} />
        </section>
      ) : null}
    </main>
  );
}

function Pagination({ loading, offset, onPage, total }: { loading: boolean; offset: number; onPage(offset: number): void; total: number }) {
  return (
    <nav aria-label="Pagination" className="ops-pagination">
      <Button disabled={loading || offset === 0} onClick={() => onPage(Math.max(0, offset - limit))} variant="outline">Previous</Button>
      <p className="tabular-nums">{total === 0 ? 0 : offset + 1}–{Math.min(total, offset + limit)} of {total}</p>
      <Button disabled={loading || offset + limit >= total} onClick={() => onPage(offset + limit)} variant="outline">Next</Button>
    </nav>
  );
}
