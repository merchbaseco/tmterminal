import type { inferRouterOutputs } from "@trpc/server";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import type { AppRouter } from "../../server/src/api/router.ts";

type MarkDetail = inferRouterOutputs<AppRouter>["marks"]["get"];

const statusLabels = {
  dead: "Dead",
  live: "Live",
  unknown: "Status unavailable",
} as const;
const statusChipClasses = {
  dead: "text-muted-foreground",
  live: "border-primary bg-primary text-primary-foreground",
  unknown: "border-dashed text-muted-foreground",
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
      <main className="page-shell isolate flex min-h-[calc(100dvh-3.75rem)] flex-col pt-[clamp(2rem,5vw,5.5rem)]">
        <a
          className="text-inherit underline decoration-border underline-offset-[0.3em]"
          href="/search"
          onClick={handleBack}
        >
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
      <main
        aria-busy="true"
        className="page-shell isolate flex min-h-[calc(100dvh-3.75rem)] flex-col pt-[clamp(2rem,5vw,5.5rem)]"
      >
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
    <main className="page-shell isolate flex min-h-[calc(100dvh-3.75rem)] flex-col pt-[clamp(2rem,5vw,5.5rem)]">
      <a
        className="text-inherit underline decoration-border underline-offset-[0.3em]"
        href="/search"
        onClick={handleBack}
      >
        ← Back to results
      </a>

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-8 py-[clamp(1.5rem,4vw,3rem)] pb-[clamp(2rem,4vw,3rem)] max-[48rem]:grid-cols-1">
        <div>
          <p className="mb-[0.85rem] font-[650] text-[0.75rem] uppercase tracking-[0.1em]">
            United States trademark record
          </p>
          <h1 className="wrap-anywhere m-0 font-black text-[clamp(3.25rem,7vw,6rem)] leading-[0.78] tracking-[-0.055em]">
            {mark.mark.wordMark ?? "Untitled mark"}
          </h1>
        </div>
        <div className="grid min-w-52 gap-[0.4rem] border-border border-l py-3 pl-4 text-base max-[48rem]:min-w-0 max-[48rem]:border-t max-[48rem]:border-l-0 max-[48rem]:pl-0 [&>p:not(:first-child)]:text-muted-foreground [&_p]:m-0">
          <p className="flex items-center">
            <strong
              className={cn(
                "inline-flex min-h-6 items-center rounded-[2px] border border-current px-[0.45rem] py-[0.15rem] font-bold text-[0.75rem] uppercase leading-none tracking-[0.1em]",
                statusChipClasses[mark.mark.status]
              )}
              data-status={mark.mark.status}
            >
              {statusLabels[mark.mark.status]}
            </strong>
          </p>
          <p className="tabular-nums">
            {mark.mark.statusDate
              ? `Status date ${mark.mark.statusDate}`
              : "Status date unavailable"}
          </p>
          <p className="font-[650] text-[0.75rem] uppercase tracking-[0.1em]">
            USPTO status {mark.mark.statusCode ?? "unknown"}
          </p>
        </div>
      </header>

      <section
        aria-labelledby="goods-heading"
        className="grid grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)] gap-[clamp(1.5rem,4vw,3rem)] border-border border-t py-[clamp(1.5rem,3vw,2.25rem)] max-[48rem]:grid-cols-1"
      >
        <div className="grid content-start gap-[0.65rem]">
          <h2
            className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]"
            id="goods-heading"
          >
            Goods/services
          </h2>
          <p className="m-0 font-[650] text-[0.75rem] text-muted-foreground uppercase tabular-nums tracking-[0.1em]">
            International {mark.classes.length === 1 ? "class" : "classes"}{" "}
            {mark.classes
              .map((classification) => classification.internationalCode ?? "unknown")
              .join(", ")}{" "}
            · Drawing code {mark.mark.markDrawingCode ?? "unknown"}
          </p>
        </div>
        <div className="col-start-2 grid list-none gap-2 p-0 max-[48rem]:col-start-1">
          {goodsServices.map((goods) => (
            <p
              className="m-0 max-w-[68ch] text-base"
              key={`${goods.typeCode ?? "goods"}-${goods.text ?? "description-unavailable"}`}
            >
              {goods.text ?? "Description unavailable"}
            </p>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="record-heading"
        className="border-border border-t py-[clamp(1.25rem,2.5vw,1.75rem)]"
      >
        <h2
          className="mt-0 mb-3 font-[650] text-[0.75rem] uppercase tracking-[0.1em]"
          id="record-heading"
        >
          Record
        </h2>
        <dl className="[&_dd]:wrap-anywhere m-0 grid grid-cols-4 border-border border-t border-l tabular-nums max-[64rem]:grid-cols-2 [&>div]:grid [&>div]:min-h-[4.5rem] [&>div]:content-start [&>div]:gap-[0.4rem] [&>div]:border-border [&>div]:border-r [&>div]:border-b [&>div]:px-3 [&>div]:py-[0.65rem] [&_dd:not(.record-owner)]:whitespace-nowrap [&_dd]:m-0 [&_dd]:text-base [&_dd]:text-muted-foreground [&_dt]:font-[650] [&_dt]:text-[0.75rem] [&_dt]:text-muted-foreground [&_dt]:uppercase [&_dt]:tracking-[0.1em]">
          <div>
            <dt>Owner</dt>
            <dd className="record-owner grid gap-1">
              <strong className="text-base text-foreground">
                {ownerNames[0] ?? "Unknown owner"}
              </strong>
              {ownerNames.length > 1 ? (
                <span className="text-base">
                  Also recorded as {ownerNames.slice(1).join(" · ")}
                </span>
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

      <section
        aria-labelledby="history-heading"
        className="grid grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)] gap-[clamp(1.5rem,4vw,3rem)] border-border border-t py-[clamp(1.5rem,3vw,2.25rem)] max-[48rem]:grid-cols-1"
      >
        <h2
          className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]"
          id="history-heading"
        >
          Status history as reported by USPTO
        </h2>
        {statusEvents.length === 0 ? (
          <p>No source-reported status events in this materialization.</p>
        ) : (
          <ol
            aria-label="Status history as reported by USPTO"
            className="col-start-2 m-0 grid list-none p-0 max-[48rem]:col-start-1 [&_li:first-child]:border-t-0 [&_li:first-child]:pt-0 [&_li]:flex [&_li]:justify-between [&_li]:gap-4 [&_li]:border-border [&_li]:border-t [&_li]:py-4 [&_span]:shrink-0 [&_span]:whitespace-nowrap [&_span]:text-muted-foreground"
          >
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

      <section
        aria-labelledby="provenance-heading"
        className="grid grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)] gap-[clamp(1.5rem,4vw,3rem)] border-border border-t py-[clamp(1.5rem,3vw,2.25rem)] max-[48rem]:grid-cols-1"
      >
        <h2
          className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]"
          id="provenance-heading"
        >
          USPTO source and provenance
        </h2>
        <p className="m-0">
          Canonical projection {mark.provenance.versions.projection}; source profile{" "}
          {mark.provenance.versions.sourceProfile}.
        </p>
        <ul className="[&_code]:wrap-anywhere col-start-2 m-0 grid list-none p-0 max-[48rem]:col-start-1 [&_code]:text-muted-foreground [&_li:first-child]:border-t-0 [&_li:first-child]:pt-0 [&_li]:grid [&_li]:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_minmax(0,2fr)_minmax(0,2fr)] [&_li]:gap-[0.35rem] [&_li]:border-border [&_li]:border-t [&_li]:py-4 max-[48rem]:[&_li]:grid-cols-1 max-[64rem]:[&_li]:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] [&_span]:text-muted-foreground">
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

      <footer className="relative left-1/2 mt-auto w-dvw -translate-x-1/2 border-border border-t text-muted-foreground/70">
        <p className="page-shell my-0 py-8">{mark.legalDisclaimer}</p>
      </footer>
    </main>
  );
}
