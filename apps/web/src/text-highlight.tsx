import type { ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type HighlightTone, highlightToneStyles } from "./highlight-tones.ts";

export function TextHighlight({
  active = false,
  children,
  label,
  onClick,
  tone,
  tooltip,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
  tone: HighlightTone;
  tooltip: string;
}) {
  const toneStyle = highlightToneStyles[tone];
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        aria-pressed={active}
        className="group relative isolate inline-flex cursor-pointer items-baseline whitespace-nowrap border-0 bg-transparent p-0 font-[650] text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        data-tone={tone}
        delay={0}
        onClick={onClick}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-1 -inset-y-0.5 -z-10 h-[calc(100%+0.25rem)] w-[calc(100%+0.5rem)]"
          preserveAspectRatio="none"
          viewBox="0 0 137 25"
        >
          <path
            className={cn(
              "origin-center transition-transform duration-100 group-hover:-translate-y-0.5 group-hover:scale-y-110",
              toneStyle.fill,
              active && toneStyle.active
            )}
            d="M0.823 22.988C2.122 24.66 14.052 22.913 20.667 22.876L128.906 22.703C130.406 22.703 131.393 21.517 131.665 20.522C132.23 17.143 132.726 15.889 133.13 13.466C133.535 11.043 133.968 8.402 134.203 5.664C134.217 5.5 134.26 5.07 134.295 4.583C134.381 3.397 133.639 2.522 132.734 2.476C116.977 1.666 41.65 1.765 35.412 1.8L15.568 1.911C11.85 1.932 5.729 1.369 3.821 2.632C2.729 3.355 2.593 6.242 2.321 7.237C1.756 9.301 1.725 10.077 1.321 12.501C0.916 14.924 1.318 14.475 0.821 17.106C0.439 19.126 -0.679 21.053 0.823 22.988Z"
          />
        </svg>
        <span className="relative">{children}</span>
      </TooltipTrigger>
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
