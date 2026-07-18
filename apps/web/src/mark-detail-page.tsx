import type { inferRouterOutputs } from "@trpc/server";
import { type MouseEvent, useCallback, useEffect, useState } from "react";

import type { AppRouter } from "../../server/src/api/router.ts";

type MarkDetail = inferRouterOutputs<AppRouter>["marks"]["get"];

const statusLabels = {
  dead: "Dead",
  live: "Live",
  unknown: "Status unavailable",
} as const;
const ownerNameSeparators = /[^\p{L}\p{N}]+/gu;

function distinctOwnerNames(owners: MarkDetail["owners"]) {
  const names = new Map<string, string>();
  for (const owner of owners) {
    const name = owner.partyName ?? "Unknown owner";
    const key = name
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(ownerNameSeparators, " ")
      .trim();
    if (!names.has(key)) {
      names.set(key, name);
    }
  }
  return [...names.values()];
}

function relevantGoodsServices(goodsServices: MarkDetail["goodsServices"]) {
  const goods = goodsServices.filter((item) => item.typeCode?.startsWith("GS"));
  const visibleGoods = goods.length > 0 ? goods : goodsServices;
  return visibleGoods.toSorted((left, right) => {
    const priority = (typeCode: string | null) => (typeCode?.startsWith("GS025") ? 0 : 1);
    return priority(left.typeCode) - priority(right.typeCode);
  });
}

export interface MarkApi {
  get: (serialNumber: string) => Promise<MarkDetail>;
}

export function MarkDetailPage({
  api,
  onBack,
  serialNumber,
}: {
  api: MarkApi;
  onBack: () => void;
  serialNumber: string;
}) {
  const [mark, setMark] = useState<MarkDetail | null>(null);
  const [error, setError] = useState<"failed" | "not-found" | null>(null);

  const handleBack = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      onBack();
    },
    [onBack]
  );

  useEffect(() => {
    let active = true;
    api
      .get(serialNumber)
      .then((detail) => {
        if (active) {
          setMark(detail);
        }
      })
      .catch((cause: unknown) => {
        const data = cause instanceof Error && "data" in cause ? cause.data : null;
        const notFound =
          data && typeof data === "object" && "code" in data && data.code === "NOT_FOUND";
        if (active) {
          setError(notFound ? "not-found" : "failed");
        }
      });
    return () => {
      active = false;
    };
  }, [api, serialNumber]);

  if (error) {
    return (
      <main className="mark-detail-shell">
        <a className="back-link" href="/search" onClick={handleBack}>
          ← Back to results
        </a>
        <p role="alert">
          {error === "not-found" ? "Trademark not found" : "Trademark detail could not be loaded."}
        </p>
      </main>
    );
  }

  if (!mark) {
    return (
      <main aria-busy="true" className="mark-detail-shell">
        <p>Loading trademark…</p>
      </main>
    );
  }

  const ownerNames = distinctOwnerNames(mark.owners);
  const goodsServices = relevantGoodsServices(mark.goodsServices);
  const statusEvents = mark.statusEvents.toSorted((left, right) =>
    (right.date ?? "").localeCompare(left.date ?? "")
  );

  return (
    <main className="mark-detail-shell">
      <a className="back-link" href="/search" onClick={handleBack}>
        ← Back to results
      </a>

      <header className="mark-heading">
        <div>
          <p className="eyebrow">United States trademark record</p>
          <h1>{mark.mark.wordMark ?? "Untitled mark"}</h1>
        </div>
        <div className="mark-status">
          <p className="mark-status-disposition">
            <strong className={`status-chip status-${mark.mark.status}`}>
              {statusLabels[mark.mark.status]}
            </strong>
          </p>
          <p className="tabular-nums">
            {mark.mark.statusDate
              ? `Status date ${mark.mark.statusDate}`
              : "Status date unavailable"}
          </p>
          <p className="status-code">USPTO status {mark.mark.statusCode ?? "unknown"}</p>
        </div>
      </header>

      <section aria-labelledby="goods-heading" className="detail-section goods-section">
        <div className="goods-heading">
          <h2 id="goods-heading">Goods/services</h2>
          <p className="goods-meta tabular-nums">
            International {mark.classes.length === 1 ? "class" : "classes"}{" "}
            {mark.classes
              .map((classification) => classification.internationalCode ?? "unknown")
              .join(", ")}{" "}
            · Drawing code {mark.mark.markDrawingCode ?? "unknown"}
          </p>
        </div>
        <div className="goods-list">
          {goodsServices.map((goods) => (
            <p
              className="detail-copy"
              key={`${goods.typeCode ?? "goods"}-${goods.text ?? "description-unavailable"}`}
            >
              {goods.text ?? "Description unavailable"}
            </p>
          ))}
        </div>
      </section>

      <section aria-labelledby="record-heading" className="record-section">
        <h2 id="record-heading">Record</h2>
        <dl className="record-facts tabular-nums">
          <div>
            <dt>Owner</dt>
            <dd className="record-owner">
              <strong>{ownerNames[0] ?? "Unknown owner"}</strong>
              {ownerNames.length > 1 ? (
                <span>Also recorded as {ownerNames.slice(1).join(" · ")}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Serial number</dt>
            <dd>{mark.mark.serialNumber}</dd>
          </div>
          <div>
            <dt>Registration</dt>
            <dd>{mark.mark.registrationNumber ?? "Not registered"}</dd>
          </div>
          <div>
            <dt>Filing date</dt>
            <dd>{mark.mark.filingDate ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Registration date</dt>
            <dd>{mark.mark.registrationDate ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Source transaction</dt>
            <dd>{mark.mark.sourceTransactionDate ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Drawing code</dt>
            <dd>{mark.mark.markDrawingCode ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Classes</dt>
            <dd>
              {mark.classes
                .map((classification) => classification.internationalCode ?? "Unknown")
                .join(", ")}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="history-heading" className="detail-section">
        <h2 id="history-heading">Status history as reported by USPTO</h2>
        {statusEvents.length === 0 ? (
          <p>No source-reported status events in this materialization.</p>
        ) : (
          <ol aria-label="Status history as reported by USPTO" className="status-history">
            {statusEvents.map((event) => (
              <li
                key={`${event.code ?? "event"}-${event.date ?? "unknown"}-${event.number ?? "number-unknown"}-${event.type ?? "type-unknown"}`}
              >
                <strong>{event.description ?? event.code ?? "Status event"}</strong>
                <span>{event.date ?? "Date unknown"}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="provenance-heading" className="detail-section">
        <h2 id="provenance-heading">USPTO source and provenance</h2>
        <p>
          Canonical projection {mark.provenance.versions.projection}; source profile{" "}
          {mark.provenance.versions.sourceProfile}.
        </p>
        <ul className="provenance-list">
          {mark.provenance.contributors.map((contributor) => (
            <li
              key={`${contributor.group}-${contributor.claimPath}-${contributor.artifactVersionSha256}-${contributor.physicalRecordIndex}`}
            >
              <strong>{contributor.group}</strong>
              <span>
                {contributor.product} · record {contributor.physicalRecordIndex}
              </span>
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
