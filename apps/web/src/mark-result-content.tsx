import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

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
  dead: "text-muted-foreground",
  live: "border-primary bg-primary text-primary-foreground",
  unknown: "border-dashed text-muted-foreground",
} as const;
const typeLabels = {
  design: "Design",
  other: "Other",
  text: "Text",
  typeset: "Typeset",
} as const;

export function MarkResultContent({
  contextLabel,
  item,
  onOpen,
}: {
  contextLabel: string;
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
      <div className="grid min-w-0 gap-[0.1rem]" data-slot="result-main">
        <div className="flex min-w-0 items-baseline gap-3">
          <a
            aria-label={`${item.wordMark}, ${statusLabels[item.status]}, serial number ${item.serialNumber}`}
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-extrabold text-[1.5rem] text-inherit leading-[1.1] tracking-[-0.03em] no-underline after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-primary focus-visible:after:-outline-offset-2"
            href={`/marks/${item.serialNumber}`}
            onClick={open}
          >
            {item.wordMark}
          </a>
          {contextLabel ? (
            <span className="shrink-0 font-bold text-[0.65rem] text-muted-foreground uppercase tracking-[0.08em]">
              {contextLabel}
            </span>
          ) : null}
        </div>
        <p className="flex min-w-0 gap-x-[0.55rem] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[0.85rem] text-muted-foreground leading-[1.3] tracking-normal [&>span+span]:before:mr-[0.55rem] [&>span+span]:before:content-['·'] [&>span:first-child]:min-w-0 [&>span:first-child]:overflow-hidden [&>span:first-child]:text-ellipsis [&>span]:shrink-0">
          <span>{item.owner ?? "Owner unavailable"}</span>
          <span>{typeLabels[item.type]}</span>
          {classLabel ? <span>{classLabel}</span> : null}
        </p>
      </div>
      <div
        className="grid min-w-[6.5rem] justify-items-end gap-[0.3rem] whitespace-nowrap tabular-nums max-[48rem]:min-w-[4.5rem]"
        data-slot="result-meta"
      >
        <span
          className={cn(
            "inline-flex min-h-6 items-center rounded-[2px] border border-current px-[0.45rem] py-[0.15rem] font-bold text-[0.7rem] uppercase leading-none tracking-[0.08em]",
            statusChipClasses[item.status]
          )}
          data-slot="result-status"
          data-status={item.status}
        >
          {statusChipLabels[item.status]}
        </span>
        {item.statusDate ? (
          <time className="text-[0.8rem] text-muted-foreground" dateTime={item.statusDate}>
            {item.statusDate}
          </time>
        ) : null}
      </div>
    </>
  );
}
