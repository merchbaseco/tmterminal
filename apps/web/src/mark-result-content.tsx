import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { type HighlightTone, highlightToneStyles } from "./highlight-tones.ts";

interface MarkResult {
  internationalClasses: string[];
  owner: string | null;
  serialNumber: string;
  status: "dead" | "live" | "unknown";
  statusDate: string | null;
  type: "design" | "other" | "text" | "typeset";
  wordMark: string;
}

const statusLabels = { dead: "Dead", live: "Live", unknown: "Status unavailable" } as const;
const statusChipLabels = { dead: "Dead", live: "Live", unknown: "Unknown" } as const;
const statusChipClasses = {
  dead: "border-border text-muted-foreground",
  live: "border-primary bg-primary text-primary-foreground",
  unknown: "border-border border-dashed text-muted-foreground",
} as const;
const typeLabels = {
  design: "Design",
  other: "Other",
  text: "Text",
  typeset: "Typeset",
} as const;

export function MarkResultContent({
  contextLabel,
  indicators = [],
  item,
  onOpen,
}: {
  contextLabel: string;
  indicators?: Array<{ label: string; tone: HighlightTone }>;
  item: MarkResult;
  onOpen: (serialNumber: string, scrollOffset: number) => void;
}) {
  const open = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      onOpen(item.serialNumber, window.scrollY);
    },
    [item.serialNumber, onOpen]
  );
  const classLabel =
    item.internationalClasses.length === 1 && item.internationalClasses[0] === "025"
      ? null
      : `IC ${item.internationalClasses.join(", ")}`;

  return (
    <>
      <div
        className="grid min-w-0 content-center gap-1 px-4 py-3 max-[48rem]:py-4"
        data-slot="result-main"
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <a
            aria-label={`${item.wordMark}, ${statusLabels[item.status]}, serial number ${item.serialNumber}`}
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-2xl text-inherit tracking-[-0.025em] no-underline after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-primary focus-visible:after:-outline-offset-2"
            href={`/marks/${item.serialNumber}`}
            onClick={open}
          >
            {item.wordMark}
          </a>
          {indicators.length > 0 ? (
            <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1">
              {indicators.map((indicator) => (
                <span
                  className={cn(
                    "h-2 w-3 shrink-0 -skew-x-6",
                    highlightToneStyles[indicator.tone].indicator
                  )}
                  data-tone={indicator.tone}
                  key={`${indicator.label}-${indicator.tone}`}
                />
              ))}
            </span>
          ) : null}
          {contextLabel ? (
            <p className="m-0 shrink-0 font-medium text-muted-foreground text-sm">{contextLabel}</p>
          ) : null}
        </div>
        <p className="m-0 flex min-w-0 flex-wrap gap-x-[0.55rem] text-base text-muted-foreground min-[48rem]:flex-nowrap min-[48rem]:overflow-hidden min-[48rem]:whitespace-nowrap [&>span:first-child]:min-w-0 min-[48rem]:[&>span:first-child]:overflow-hidden min-[48rem]:[&>span:first-child]:text-ellipsis min-[48rem]:[&>span:last-child]:min-w-0 min-[48rem]:[&>span:last-child]:overflow-hidden min-[48rem]:[&>span:last-child]:text-ellipsis min-[48rem]:[&>span:not(:first-child):not(:last-child)]:shrink-0 [&>span:not(:last-child)]:after:ml-[0.55rem] [&>span:not(:last-child)]:after:content-['·']">
          <span>{item.owner ?? "Owner unavailable"}</span>
          <span>{typeLabels[item.type]}</span>
          {classLabel ? <span>{classLabel}</span> : null}
        </p>
      </div>
      <div
        className="grid min-w-[10rem] content-center justify-items-end gap-1.5 whitespace-nowrap border-border border-l px-4 py-3 tabular-nums max-[48rem]:min-w-[6.5rem] max-[48rem]:py-4"
        data-slot="result-meta"
      >
        <span
          className={cn(
            "inline-flex min-h-6 items-center rounded-sm border px-2 py-0.5 font-semibold text-xs uppercase tracking-[0.1em]",
            statusChipClasses[item.status]
          )}
          data-slot="result-status"
          data-status={item.status}
        >
          {statusChipLabels[item.status]}
        </span>
        {item.statusDate ? (
          <p className="m-0 text-base text-muted-foreground">
            <time dateTime={item.statusDate}>{item.statusDate}</time>
          </p>
        ) : null}
      </div>
    </>
  );
}
