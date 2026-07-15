import { useEffect, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../../server/src/api/router.ts";

type MarkDetail = inferRouterOutputs<AppRouter>["marks"]["get"];

export type MarkApi = {
  get(serialNumber: string): Promise<MarkDetail>;
};

export function MarkDetailPage({ api, serialNumber }: { api: MarkApi; serialNumber: string }) {
  const [mark, setMark] = useState<MarkDetail | null>(null);
  const [error, setError] = useState<"failed" | "not-found" | null>(null);

  useEffect(() => {
    let active = true;
    void api.get(serialNumber).then((detail) => {
      if (active) setMark(detail);
    }).catch((cause: unknown) => {
      const data = cause instanceof Error && "data" in cause ? cause.data : null;
      const notFound = data && typeof data === "object" && "code" in data && data.code === "NOT_FOUND";
      if (active) setError(notFound ? "not-found" : "failed");
    });
    return () => {
      active = false;
    };
  }, [api, serialNumber]);

  if (error) {
    return (
      <main className="mark-detail-shell">
        <a className="back-link" href="/">← Back to results</a>
        <p role="alert">{error === "not-found" ? "Trademark not found" : "Trademark detail could not be loaded."}</p>
      </main>
    );
  }

  if (!mark) {
    return <main aria-busy="true" className="mark-detail-shell"><p>Loading trademark…</p></main>;
  }

  return (
    <main className="mark-detail-shell">
      <a className="back-link" href="/">← Back to results</a>

      <header className="mark-heading">
        <div>
          <p className="eyebrow">United States trademark record</p>
          <h1>{mark.mark.wordMark ?? "Untitled mark"}</h1>
        </div>
        <p className="status-code">Status {mark.mark.statusCode ?? "unknown"}</p>
      </header>

      <section className="detail-section" aria-labelledby="identity-heading">
        <h2 id="identity-heading">Identity and dates</h2>
        <dl className="detail-grid tabular-nums">
          <div><dt>Serial number</dt><dd>{mark.mark.serialNumber}</dd></div>
          <div><dt>Registration number</dt><dd>{mark.mark.registrationNumber ?? "Not registered"}</dd></div>
          <div><dt>Filing date</dt><dd>{mark.mark.filingDate ?? "Unknown"}</dd></div>
          <div><dt>Registration date</dt><dd>{mark.mark.registrationDate ?? "Unknown"}</dd></div>
          <div><dt>Status date</dt><dd>{mark.mark.statusDate ?? "Unknown"}</dd></div>
          <div><dt>Source transaction</dt><dd>{mark.mark.sourceTransactionDate ?? "Unknown"}</dd></div>
          <div><dt>Drawing code</dt><dd>{mark.mark.markDrawingCode ?? "Unknown"}</dd></div>
        </dl>
      </section>

      <section className="detail-section" aria-labelledby="owners-heading">
        <h2 id="owners-heading">Owner</h2>
        {mark.owners.map((owner, index) => (
          <p className="detail-lead" key={`${owner.entryNumber ?? "owner"}-${index}`}>
            {owner.partyName ?? "Unknown owner"}
          </p>
        ))}
      </section>

      <section className="detail-section" aria-labelledby="classes-heading">
        <h2 id="classes-heading">Classes and goods/services</h2>
        <div className="class-list">
          {mark.classes.map((classification, index) => (
            <article key={`${classification.internationalCode ?? "class"}-${index}`}>
              <p className="class-code tabular-nums">International Class {classification.internationalCode ?? "unknown"}</p>
            </article>
          ))}
          {mark.goodsServices.map((goods, index) => (
            <p key={`${goods.typeCode ?? "goods"}-${index}`}>{goods.text ?? "Description unavailable"}</p>
          ))}
        </div>
      </section>

      <section className="detail-section" aria-labelledby="history-heading">
        <h2 id="history-heading">Status history</h2>
        {mark.statusEvents.length === 0 ? <p>No source-reported status events in this materialization.</p> : (
          <ol className="status-history" role="list">
            {mark.statusEvents.map((event, index) => (
              <li key={`${event.code ?? "event"}-${event.date ?? "unknown"}-${index}`}>
                <strong>{event.description ?? event.code ?? "Status event"}</strong>
                <span>{event.date ?? "Date unknown"}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="detail-section" aria-labelledby="provenance-heading">
        <h2 id="provenance-heading">USPTO source and provenance</h2>
        <p>
          Canonical projection {mark.provenance.versions.projection}; source profile {mark.provenance.versions.sourceProfile}.
        </p>
        <ul className="provenance-list" role="list">
          {mark.provenance.contributors.map((contributor) => (
            <li key={`${contributor.group}-${contributor.claimPath}-${contributor.artifactVersionSha256}-${contributor.physicalRecordIndex}`}>
              <strong>{contributor.group}</strong>
              <span>{contributor.product} · record {contributor.physicalRecordIndex}</span>
              <code>{contributor.claimPath}</code>
              <code>{contributor.artifactVersionSha256}</code>
            </li>
          ))}
        </ul>
      </section>

      <footer className="legal-disclaimer">{mark.legalDisclaimer}</footer>
    </main>
  );
}
