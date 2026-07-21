import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  ArrowUpRight01Icon,
  Copy01Icon,
  Tick01Icon,
} from "@hugeicons-pro/core-stroke-rounded";
import type { inferRouterOutputs } from "@trpc/server";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { AppRouter } from "../../server/src/api/router.ts";
import { LegalFooter } from "./legal-footer.tsx";

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
const markTypeLabels = {
  design: "Design mark",
  other: "Mark",
  text: "Text mark",
  typeset: "Typeset mark",
} as const;
const ownerNameSeparators = /[^\p{L}\p{N}]+/gu;
const uppercaseRun = /\p{Lu}/u;
const lowercaseRun = /\p{Ll}/u;
const goodsServiceClassCodePattern = /^GS(\d{3})/;
const historyPreviewCount = 5;

function officialRecordHref(serialNumber: string) {
  return `https://tsdr.uspto.gov/#caseNumber=${serialNumber}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`;
}

function readableEventText(text: string) {
  if (!(uppercaseRun.test(text) && !lowercaseRun.test(text))) {
    return text;
  }
  const lowered = text.toLocaleLowerCase("en-US");
  return lowered.charAt(0).toLocaleUpperCase("en-US") + lowered.slice(1);
}

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

function goodsServiceClassCode(typeCode: string | null, classCodes: ReadonlySet<string>) {
  const code = typeCode?.match(goodsServiceClassCodePattern)?.[1] ?? null;
  return code && classCodes.has(code) ? code : null;
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
  const [serialCopied, setSerialCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(copyTimer.current);
    },
    []
  );

  const copySerialNumber = useCallback(() => {
    navigator.clipboard.writeText(serialNumber).then(
      () => {
        setSerialCopied(true);
        window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setSerialCopied(false), 1500);
      },
      () => setSerialCopied(false)
    );
  }, [serialNumber]);

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
      <main className="page-shell isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col pt-[clamp(1rem,2vw,2rem)]">
        <a
          className="inline-flex items-center gap-1.5 text-inherit underline decoration-border underline-offset-[0.3em]"
          href="/search"
          onClick={handleBack}
        >
          <HugeiconsIcon aria-hidden="true" className="size-4" icon={ArrowLeft02Icon} />
          Back to results
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
        className="page-shell isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col pt-[clamp(1rem,2vw,2rem)]"
      >
        <p>Loading trademark…</p>
      </main>
    );
  }

  const ownerNames = distinctOwnerNames(mark.owners);
  const goodsServices = relevantGoodsServices(mark.goodsServices);
  const classCodes = [
    ...new Set(mark.classes.flatMap(({ internationalCode }) => internationalCode ?? [])),
  ];
  const classCodeSet = new Set(classCodes);
  const pairedClassCodes = new Set(
    goodsServices.flatMap(({ typeCode }) => {
      const code = goodsServiceClassCode(typeCode, classCodeSet);
      return code ? [code] : [];
    })
  );
  const unpairedClassCodes = classCodes.filter((code) => !pairedClassCodes.has(code));

  return (
    <main className="page-shell isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col pt-[clamp(1rem,2vw,2rem)]">
      <a
        className="inline-flex items-center gap-1.5 text-inherit underline decoration-border underline-offset-[0.3em]"
        href="/search"
        onClick={handleBack}
      >
        <HugeiconsIcon aria-hidden="true" className="size-4" icon={ArrowLeft02Icon} />
        Back to results
      </a>

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-8 pt-[clamp(1.25rem,2vw,1.75rem)] pb-[clamp(2rem,4vw,3rem)] max-[48rem]:grid-cols-1">
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
          <p className="pt-2">
            <Button
              className="max-[48rem]:w-full"
              render={
                <a
                  href={officialRecordHref(mark.mark.serialNumber)}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="sm"
              variant="outline"
            >
              Open official USPTO record
              <HugeiconsIcon aria-hidden="true" icon={ArrowUpRight01Icon} />
            </Button>
          </p>
        </div>
      </header>

      <section
        aria-labelledby="goods-heading"
        className="grid gap-4 border-border border-t py-[clamp(1.5rem,3vw,2.25rem)]"
      >
        <h2 className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]" id="goods-heading">
          Goods/services
        </h2>
        <table
          aria-label="Goods and services by class"
          className="w-full table-fixed border-collapse"
        >
          <colgroup>
            <col className="w-20 sm:w-28" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="whitespace-nowrap pb-2 text-left font-medium text-muted-foreground">
                Class
              </th>
              <th className="whitespace-nowrap pb-2 text-left font-medium text-muted-foreground">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {goodsServices.map((goods) => {
              const classCode = goodsServiceClassCode(goods.typeCode, classCodeSet);
              return (
                <tr key={`${goods.typeCode ?? "goods"}-${goods.text ?? "description-unavailable"}`}>
                  <td className="py-3 pr-4 align-top">
                    <div className="inline-flex min-h-6 min-w-12 items-center justify-center rounded-[2px] border border-border px-[0.45rem] py-[0.15rem] font-bold text-[0.75rem] tabular-nums tracking-[0.1em]">
                      {classCode ? (
                        <>
                          <span className="sr-only">International class </span>
                          {classCode}
                        </>
                      ) : (
                        <>
                          <span className="sr-only">International class not recorded</span>
                          <span aria-hidden="true">—</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="wrap-anywhere py-3 align-top text-base">
                    {goods.text ?? "Description unavailable"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {unpairedClassCodes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <p className="m-0 font-medium text-muted-foreground text-sm">
              {pairedClassCodes.size > 0 ? "Other classes in record" : "International classes"}
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {unpairedClassCodes.map((code) => (
                <li
                  className="inline-flex min-h-6 min-w-12 items-center justify-center rounded-[2px] border border-border px-[0.45rem] py-[0.15rem] font-bold text-[0.75rem] tabular-nums tracking-[0.1em]"
                  key={code}
                >
                  <span className="sr-only">International class </span>
                  {code}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="record-heading"
        className="grid gap-3 border-border border-t py-[clamp(1.25rem,2.5vw,1.75rem)]"
      >
        <h2
          className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]"
          id="record-heading"
        >
          Record
        </h2>
        <dl className="[&_dd]:wrap-anywhere m-0 grid grid-cols-[5fr_3fr_3fr_3fr_3fr] gap-x-6 gap-y-5 tabular-nums max-[64rem]:grid-cols-2 [&>div]:grid [&>div]:content-start [&>div]:gap-[0.4rem] [&_dd:not(.record-owner)]:whitespace-nowrap [&_dd]:m-0 [&_dd]:text-base [&_dd]:text-muted-foreground [&_dt]:font-[650] [&_dt]:text-[0.75rem] [&_dt]:text-muted-foreground [&_dt]:uppercase [&_dt]:tracking-[0.1em]">
          <div className="max-[64rem]:col-span-2">
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
            <dt>Mark type</dt>
            <dd>{markTypeLabels[mark.type]}</dd>
          </div>
          <div>
            <dt>Serial number</dt>
            <dd className="flex items-center gap-2">
              {mark.mark.serialNumber}
              <button
                aria-label="Copy serial number"
                className="inline-flex size-6 cursor-pointer items-center justify-center rounded-[2px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                onClick={copySerialNumber}
                type="button"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-3.5"
                  icon={serialCopied ? Tick01Icon : Copy01Icon}
                />
              </button>
              <span aria-live="polite" className="sr-only">
                {serialCopied ? "Serial number copied" : ""}
              </span>
            </dd>
          </div>
          <div>
            <dt>Registration</dt>
            <dd className="grid gap-1">
              {mark.mark.registrationNumber ?? "Not registered"}
              {mark.mark.registrationDate ? (
                <span>Registered {mark.mark.registrationDate}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Filing date</dt>
            <dd>{mark.mark.filingDate ?? "Unknown"}</dd>
          </div>
        </dl>
      </section>

      <StatusHistorySection statusEvents={mark.statusEvents} />

      <LegalFooter text={mark.legalDisclaimer} />
    </main>
  );
}

function StatusHistorySection({ statusEvents }: { statusEvents: MarkDetail["statusEvents"] }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const sortedEvents = statusEvents.toSorted((left, right) =>
    (right.date ?? "").localeCompare(left.date ?? "")
  );
  const visibleEvents = historyOpen ? sortedEvents : sortedEvents.slice(0, historyPreviewCount);

  return (
    <section
      aria-labelledby="history-heading"
      className="grid grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)] gap-[clamp(1.5rem,4vw,3rem)] border-border border-t py-[clamp(1.5rem,3vw,2.25rem)] max-[48rem]:grid-cols-1"
    >
      <div className="grid content-start gap-[0.65rem]">
        <h2
          className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]"
          id="history-heading"
        >
          Status history
        </h2>
        <p className="m-0 text-[0.75rem] text-muted-foreground">Reported by the USPTO.</p>
      </div>
      {sortedEvents.length === 0 ? (
        <p className="col-start-2 m-0 max-[48rem]:col-start-1">No status events reported.</p>
      ) : (
        <div className="col-start-2 max-[48rem]:col-start-1">
          <ol
            aria-label="Status history"
            className="m-0 grid list-none gap-3 p-0 [&_li]:flex [&_li]:justify-between [&_li]:gap-4 [&_p]:m-0 [&_p]:font-medium [&_time]:shrink-0 [&_time]:text-muted-foreground [&_time]:tabular-nums"
            id="status-history-list"
          >
            {visibleEvents.map((event) => (
              <li
                key={`${event.code ?? "event"}-${event.date ?? "unknown"}-${event.number ?? "number-unknown"}-${event.type ?? "type-unknown"}`}
              >
                <p>{readableEventText(event.description ?? event.code ?? "Status event")}</p>
                <time dateTime={event.date ?? undefined}>{event.date ?? "Date unknown"}</time>
              </li>
            ))}
          </ol>
          {sortedEvents.length > historyPreviewCount ? (
            <Button
              aria-controls="status-history-list"
              aria-expanded={historyOpen}
              className="mt-4 w-full"
              // biome-ignore lint/performance/noJsxPropsBind: The disclosure owns this section's local boolean.
              onClick={() => setHistoryOpen((open) => !open)}
              variant="outline"
            >
              {historyOpen ? "Show fewer events" : `Show all ${sortedEvents.length} events`}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
