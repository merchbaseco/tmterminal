import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";

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
      <div className="result-main">
        <div className="result-title-line">
          <a
            aria-label={`${item.wordMark}, ${statusLabels[item.status]}, serial number ${item.serialNumber}`}
            className="result-mark"
            href={`/marks/${item.serialNumber}`}
            onClick={open}
          >
            {item.wordMark}
          </a>
          {contextLabel ? <span className="result-match">{contextLabel}</span> : null}
        </div>
        <p className="result-details">
          <span>{item.owner ?? "Owner unavailable"}</span>
          <span>{typeLabels[item.type]}</span>
          {classLabel ? <span>{classLabel}</span> : null}
        </p>
      </div>
      <div className="result-meta tabular-nums">
        <span className={`status-chip status-${item.status}`}>{statusChipLabels[item.status]}</span>
        {item.statusDate ? (
          <time className="result-date" dateTime={item.statusDate}>
            {item.statusDate}
          </time>
        ) : null}
      </div>
    </>
  );
}
