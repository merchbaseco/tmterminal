import type { ReactNode } from "react";

export function PageMasthead({
  accessory,
  description,
  title,
}: {
  accessory?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <header className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <h1 className="display-masthead m-0 whitespace-nowrap text-[clamp(2.125rem,7.4vw,9rem)]">
        {title}
      </h1>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
        <p className="m-0 max-w-[56ch] text-pretty text-base text-muted-foreground">
          {description}
        </p>
        {accessory}
      </div>
    </header>
  );
}
