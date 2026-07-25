import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { HighlightTone } from "./highlight-tones.ts";
import { MarkResultContent } from "./mark-result-content.tsx";
import type { SearchPreferences } from "./search-preferences.ts";

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
    <div
      className={cn(
        "grid min-h-20 border-border border-b",
        action && "grid-cols-[minmax(0,1fr)_var(--search-side-column)] max-[48rem]:grid-cols-1"
      )}
    >
      <div className="flex min-w-0 flex-col justify-center gap-1 px-4 py-4">
        <p className="m-0 font-semibold text-base text-foreground">{title}</p>
        <p className="m-0 max-w-[60ch] text-pretty text-base text-muted-foreground sm:text-sm">
          {description}
        </p>
      </div>
      {action ? (
        <div className="flex items-center border-border border-l px-4 py-3 max-[48rem]:justify-start max-[48rem]:border-t max-[48rem]:border-l-0 min-[48rem]:justify-center">
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function TrademarkSearchEmptyState({ query }: { query: string }) {
  return (
    <div
      aria-label={`No marks match “${query}”`}
      aria-live="polite"
      className="relative grid min-h-[clamp(18rem,32vw,27rem)] place-items-center overflow-hidden border-border border-b"
      role="status"
    >
      <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-border border-t" />
      <div aria-hidden="true" className="absolute inset-y-0 left-1/2 border-border border-l" />
      <div
        aria-hidden="true"
        className="relative size-[clamp(8rem,18vw,15rem)] rounded-full border-[clamp(0.75rem,1.5vw,1.25rem)] border-muted-foreground/20"
      >
        <div className="-translate-1/2 absolute top-1/2 left-1/2 h-[140%] w-[clamp(0.75rem,1.5vw,1.25rem)] rotate-45 bg-primary/20" />
      </div>
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
  density = "compact",
  indicators,
  item,
  onOpen,
  position,
  total,
}: {
  contextLabel?: string;
  density?: SearchPreferences["resultDensity"];
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
        "isolate grid w-full grid-cols-[minmax(0,1fr)_var(--search-side-column)] items-stretch border-border border-b has-[a:hover]:bg-accent/50 max-[48rem]:grid-cols-[minmax(0,1fr)_auto]",
        density === "compact" ? "min-h-20" : "min-h-24",
        position ? "absolute top-0 left-0" : "relative"
      )}
      data-density={density}
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
