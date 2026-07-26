import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons-pro/core-stroke-rounded";
import type { MouseEvent, ReactNode } from "react";

export type BackLinkClick = (event: MouseEvent) => void;

const backLinkClassName =
  "relative inline-flex h-9 w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-base text-inherit underline decoration-border underline-offset-[0.3em] hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

/**
 * One backward affordance for every result surface: mark detail returns to
 * results, and a composer with results returns to an empty field.
 */
export function BackLink({
  children,
  href,
  onClick,
}: {
  children: ReactNode;
  href?: string;
  onClick: BackLinkClick;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className="-translate-1/2 absolute top-1/2 left-1/2 pointer-fine:hidden size-[max(100%,3rem)]"
      />
      <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={ArrowLeft02Icon} />
      {children}
    </>
  );

  if (href) {
    return (
      <a className={backLinkClassName} href={href} onClick={onClick}>
        {content}
      </a>
    );
  }
  return (
    <button className={backLinkClassName} onClick={onClick} type="button">
      {content}
    </button>
  );
}
