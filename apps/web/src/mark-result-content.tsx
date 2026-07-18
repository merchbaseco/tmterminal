import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";

interface MarkResult {
  goodsServicesExcerpt: string | null;
  internationalClasses: string[];
  owner: string | null;
  registrationNumber: string | null;
  serialNumber: string;
  status: "dead" | "live" | "unknown";
  statusDate: string | null;
  type: "design" | "other" | "text" | "typeset";
  wordMark: string;
}

const statusLabels = { dead: "Dead", live: "Live", unknown: "Status unavailable" } as const;
const typeLabels = {
  design: "Design mark",
  other: "Other mark",
  text: "Text mark",
  typeset: "Typeset mark",
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

  return (
    <>
      <a href={`/marks/${item.serialNumber}`} onClick={open}>
        {item.wordMark}
      </a>
      <div className="result-facts">
        <span>{contextLabel}</span>
        <span>{statusLabels[item.status]}</span>
        <span>IC {item.internationalClasses.join(", ")}</span>
        <span>{typeLabels[item.type]}</span>
      </div>
      <p>{item.owner ?? "Owner unavailable"}</p>
      <p className="result-goods">{item.goodsServicesExcerpt ?? "Goods/services unavailable"}</p>
      <p className="result-identities tabular-nums">
        Serial {item.serialNumber}
        {item.registrationNumber
          ? ` · Registration ${item.registrationNumber}`
          : " · Not registered"}
        {item.statusDate ? ` · Status ${item.statusDate}` : ""}
      </p>
    </>
  );
}
