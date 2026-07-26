import { cn } from "@/lib/utils";

import { BackLink, type BackLinkClick } from "./back-link.tsx";
import { LegalFooter } from "./legal-footer.tsx";

const goodsRows = ["primary", "secondary"] as const;
const historyRows = ["current", "recent", "middle", "previous", "earliest"] as const;
const recordFields = [
  { label: "Owner", valueClassName: "w-[min(24rem,75%)]" },
  { label: "Mark type", valueClassName: "w-24" },
  { label: "Serial number", valueClassName: "w-28" },
  { label: "Registration", valueClassName: "w-24" },
  { label: "Filing date", valueClassName: "w-24" },
] as const;

export function MarkDetailSkeleton({ onBack }: { onBack: BackLinkClick }) {
  return (
    <main
      aria-busy="true"
      className="page-shell page-start isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col"
      data-testid="mark-detail-skeleton"
    >
      <span aria-label="Loading trademark" className="sr-only" role="status" />
      <BackLink href="/search" onClick={onBack}>
        Back to results
      </BackLink>

      <div aria-hidden="true">
        <header className="mt-[clamp(1.25rem,2vw,1.75rem)] grid grid-cols-[minmax(0,1fr)_16.25rem] items-stretch border-border border-y max-[48rem]:grid-cols-1">
          <div className="flex flex-col justify-between py-[clamp(2rem,4vw,3rem)] pr-[clamp(1.5rem,3vw,3rem)] max-[48rem]:pr-0">
            <p className="utility-label mb-[0.85rem]">United States trademark record</p>
            <h1 className="display-masthead m-0 text-[clamp(3.25rem,7vw,6rem)]">
              <SkeletonBlock className="h-[1lh] w-[min(42rem,72%)]" />
            </h1>
          </div>
          <div className="flex min-w-64 flex-col gap-[0.4rem] border-border border-l py-[clamp(2rem,4vw,3rem)] pl-[clamp(1.5rem,3vw,3rem)] text-base max-[48rem]:min-w-0 max-[48rem]:border-t max-[48rem]:border-l-0 max-[48rem]:pl-0">
            <p className="flex h-6 items-center">
              <SkeletonBlock className="h-6 w-16" />
            </p>
            <p className="flex h-6 items-center">
              <SkeletonBlock className="h-5 w-40" />
            </p>
            <p className="flex h-4 items-center">
              <SkeletonBlock className="h-4 w-28" />
            </p>
            <p className="mt-auto pt-2">
              <SkeletonBlock className="h-8 w-full rounded-full sm:h-7" />
            </p>
          </div>
        </header>

        <section
          aria-labelledby="skeleton-goods-heading"
          className="grid grid-cols-[minmax(12rem,0.5fr)_minmax(0,2fr)] border-border border-b max-[48rem]:grid-cols-1"
        >
          <h2
            className="utility-label m-0 border-border border-r py-[clamp(1.5rem,3vw,2.25rem)] pr-[clamp(1.5rem,3vw,3rem)] max-[48rem]:border-r-0 max-[48rem]:pb-0"
            id="skeleton-goods-heading"
          >
            Goods/services
          </h2>
          <div className="grid gap-4 py-[clamp(1.5rem,3vw,2.25rem)] pl-[clamp(1.5rem,3vw,3rem)] max-[48rem]:pl-0">
            <table aria-hidden="true" className="w-full table-fixed border-collapse">
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
                {goodsRows.map((row, index) => (
                  <tr key={row}>
                    <td className="py-3 pr-4 align-top">
                      <SkeletonBlock className="h-6 w-12" />
                    </td>
                    <td className="py-3 align-top">
                      <SkeletonBlock
                        className={cn("h-[calc(1lh+1px)]", index === 1 ? "w-[58%]" : "w-[82%]")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          aria-labelledby="skeleton-record-heading"
          className="grid grid-cols-[minmax(12rem,0.5fr)_minmax(0,2fr)] border-border border-b max-[48rem]:grid-cols-1"
        >
          <h2
            className="utility-label m-0 border-border border-r py-[clamp(1.5rem,3vw,2.25rem)] pr-[clamp(1.5rem,3vw,3rem)] max-[48rem]:border-r-0 max-[48rem]:pb-0"
            id="skeleton-record-heading"
          >
            Record
          </h2>
          <dl className="[&_dt]:utility-label m-0 grid grid-cols-[5fr_3fr_3fr_3fr_3fr] gap-x-6 gap-y-5 py-[clamp(1.5rem,3vw,2.25rem)] pl-[clamp(1.5rem,3vw,3rem)] max-[64rem]:grid-cols-2 max-[48rem]:pl-0 [&>div]:grid [&>div]:content-start [&>div]:gap-[0.4rem] [&_dt]:text-muted-foreground">
            {recordFields.map((field, index) => (
              <div className={cn(index === 0 && "max-[64rem]:col-span-2")} key={field.label}>
                <dt>{field.label}</dt>
                <dd className="m-0 py-0.5">
                  <SkeletonBlock className={cn("h-5", field.valueClassName)} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="skeleton-history-heading"
          className="grid grid-cols-[minmax(12rem,0.5fr)_minmax(0,2fr)] border-border border-b max-[48rem]:grid-cols-1"
        >
          <div className="grid content-start gap-[0.65rem] border-border border-r py-[clamp(1.5rem,3vw,2.25rem)] pr-[clamp(1.5rem,3vw,3rem)] max-[48rem]:border-r-0 max-[48rem]:pb-0">
            <h2 className="utility-label m-0" id="skeleton-history-heading">
              Status history
            </h2>
            <p className="m-0 text-muted-foreground text-sm">Reported by the USPTO.</p>
          </div>
          <div
            aria-hidden="true"
            className="col-start-2 grid gap-3 py-[clamp(1.5rem,3vw,2.25rem)] pl-[clamp(1.5rem,3vw,3rem)] max-[48rem]:col-start-1 max-[48rem]:pl-0"
          >
            {historyRows.map((row, index) => (
              <div className="flex justify-between gap-4" key={row}>
                <SkeletonBlock
                  className={cn("h-6", index === 1 ? "w-[48%] max-[26rem]:h-12" : "w-[64%]")}
                />
                <SkeletonBlock
                  className={cn("h-6 w-24 shrink-0", index === 1 && "max-[26rem]:h-12")}
                />
              </div>
            ))}
          </div>
        </section>
      </div>

      <LegalFooter />
    </main>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block animate-pulse rounded-[2px] bg-muted motion-reduce:animate-none",
        className
      )}
    />
  );
}
