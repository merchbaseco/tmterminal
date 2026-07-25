import { HugeiconsIcon } from "@hugeicons/react";
import { SearchRemoveIcon } from "@hugeicons-pro/core-stroke-rounded";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { HighlightTone } from "./highlight-tones.ts";
import { MarkResultContent } from "./mark-result-content.tsx";

export interface TrademarkResultItem {
  internationalClasses: string[];
  owner: string | null;
  serialNumber: string;
  status: "dead" | "live" | "unknown";
  statusDate: string | null;
  type: "design" | "other" | "text" | "typeset";
  wordMark: string;
}

interface ResultSignal {
  label: string;
  value: ReactNode;
}

interface VirtualPosition {
  index: number;
  measureElement: (node: Element | null) => void;
  scrollMargin: number;
  start: number;
}

export function TrademarkEmptyState({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex min-h-28 flex-col items-start justify-center gap-5 border-border border-b px-4 py-7 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0 stroke-muted-foreground"
          icon={SearchRemoveIcon}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 font-semibold text-base text-foreground">{title}</p>
          <p className="m-0 max-w-[60ch] text-pretty text-base text-muted-foreground sm:text-sm">
            {description}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}

export function TrademarkResultSummary({
  signals,
  totalLabel,
}: {
  signals: [ResultSignal, ResultSignal];
  totalLabel: ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_var(--search-side-column)] border-border border-b max-[48rem]:grid-cols-1"
      data-slot="result-summary"
    >
      <div className="flex min-h-11 items-center px-4 py-1.5">
        <p className="m-0 font-semibold text-lg tabular-nums tracking-tight">{totalLabel}</p>
      </div>
      <div className="grid grid-cols-[4fr_5fr] border-border border-l max-[48rem]:border-t max-[48rem]:border-l-0">
        {signals.map((signal, index) => (
          <div
            className={cn(
              "flex min-w-0 items-center justify-center gap-1 px-2",
              index > 0 && "border-border border-l"
            )}
            key={signal.label}
          >
            <p className="m-0 shrink-0 font-semibold text-base tabular-nums">{signal.value}</p>
            <p className="m-0 whitespace-nowrap font-medium text-base text-muted-foreground sm:text-sm">
              {signal.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrademarkResultRow({
  contextLabel = "",
  indicators,
  item,
  onOpen,
  position,
  total,
}: {
  contextLabel?: string;
  indicators?: Array<{ label: string; tone: HighlightTone }>;
  item: TrademarkResultItem;
  onOpen: (serialNumber: string, scrollOffset: number) => void;
  position?: VirtualPosition;
  total?: number;
}) {
  return (
    <li
      aria-posinset={position ? position.index + 1 : undefined}
      aria-setsize={total}
      className={cn(
        "isolate grid min-h-20 w-full grid-cols-[minmax(0,1fr)_var(--search-side-column)] items-stretch border-border border-b has-[a:hover]:bg-accent/50 max-[48rem]:grid-cols-[minmax(0,1fr)_auto]",
        position ? "absolute top-0 left-0" : "relative"
      )}
      data-index={position?.index}
      data-testid="search-result-row"
      ref={position?.measureElement}
      style={
        position
          ? {
              transform: `translateY(${position.start - position.scrollMargin}px)`,
            }
          : undefined
      }
    >
      <MarkResultContent
        contextLabel={contextLabel}
        indicators={indicators}
        item={item}
        onOpen={onOpen}
      />
    </li>
  );
}
