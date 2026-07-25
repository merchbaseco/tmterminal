"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type React from "react";
import { cn } from "@/lib/utils";

export const Tooltip: typeof TooltipPrimitive.Root = TooltipPrimitive.Root;

export function TooltipTrigger({
  children,
  className,
  ...props
}: TooltipPrimitive.Trigger.Props): React.ReactElement {
  return (
    <TooltipPrimitive.Trigger
      className={className}
      data-slot="tooltip-trigger"
      {...props}
    >
      {children}
    </TooltipPrimitive.Trigger>
  );
}

export function TooltipPopup({
  className,
  side = "top",
  sideOffset = 6,
  ...props
}: TooltipPrimitive.Popup.Props & {
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
}): React.ReactElement {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="z-50"
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "rounded-md border border-border bg-popover px-2 py-1 font-medium text-base text-popover-foreground shadow-md/5 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0 dark:shadow-none sm:text-sm",
            className
          )}
          data-slot="tooltip-popup"
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
