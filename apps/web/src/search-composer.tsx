import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  LeftToRightListBulletIcon,
  Search01Icon,
  TextIcon,
} from "@hugeicons-pro/core-stroke-rounded";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SearchTool = "bulk" | "marks" | "text";

const tools = [
  { href: "/search", icon: Search01Icon, label: "Search marks", value: "marks" },
  { href: "/check", icon: TextIcon, label: "Check text", value: "text" },
  { href: "/bulk", icon: LeftToRightListBulletIcon, label: "Bulk check", value: "bulk" },
] as const;

export function SearchMasthead() {
  return (
    <header>
      <p className="mb-4 font-[650] text-base">Trademark search for Print on Demand sellers.</p>
      <h1 className="display-masthead m-0 max-w-[10ch] text-[clamp(2.75rem,min(12.5vw,18dvh),14rem)]">
        TRADEMARK
        <br />
        TERMINAL
      </h1>
    </header>
  );
}

export function SearchComposer({
  actionLabel,
  actionPlacement = "side",
  activeTool,
  fieldLabel,
  invalidActionLabel,
  loading = false,
  maxLength,
  multiline = false,
  name,
  onNavigate,
  onStartOver,
  onSubmit,
  onValueChange,
  placeholder,
  startOverLabel,
  value,
}: {
  actionLabel: string;
  actionPlacement?: "below" | "side";
  activeTool: SearchTool;
  fieldLabel: string;
  invalidActionLabel?: string;
  loading?: boolean;
  maxLength?: number;
  multiline?: boolean;
  name: string;
  onNavigate?: (href: string) => void;
  onStartOver?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  startOverLabel?: string;
  value: string;
}) {
  const stackedAction = actionPlacement === "below";
  const [showInvalidAction, setShowInvalidAction] = useState(false);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const captureField = useCallback((node: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRef.current = node;
  }, []);
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setShowInvalidAction(false);
      onValueChange(event.target.value);
    },
    [onValueChange]
  );
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (invalidActionLabel) {
        event.preventDefault();
        setShowInvalidAction(true);
        fieldRef.current?.focus();
        return;
      }
      setShowInvalidAction(false);
      onSubmit(event);
    },
    [invalidActionLabel, onSubmit]
  );

  useEffect(() => {
    if (!showInvalidAction) {
      return;
    }
    const timeout = window.setTimeout(() => setShowInvalidAction(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [showInvalidAction]);

  let displayedActionLabel = actionLabel;
  if (showInvalidAction && invalidActionLabel) {
    displayedActionLabel = invalidActionLabel;
  }

  let header: ReactNode = null;
  if (onStartOver && startOverLabel) {
    header = (
      <div className="flex pb-3">
        <button
          className="relative flex h-9 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-medium text-base text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 sm:text-sm"
          onClick={onStartOver}
          type="button"
        >
          <span
            aria-hidden="true"
            className="-translate-1/2 absolute top-1/2 left-1/2 pointer-fine:hidden size-[max(100%,3rem)]"
          />
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0 stroke-current"
            icon={ArrowLeft02Icon}
          />
          {startOverLabel}
        </button>
      </div>
    );
  } else if (onNavigate) {
    header = (
      <nav aria-label="Search mode" className="overflow-x-auto border border-border border-b-0">
        <div className="grid min-w-[26rem] grid-cols-3">
          {tools.map((tool) => (
            <SearchToolLink
              active={tool.value === activeTool}
              href={tool.href}
              icon={tool.icon}
              key={tool.value}
              label={tool.label}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>
    );
  }

  return (
    <form autoComplete="off" data-slot="trademark-search-form" onSubmit={submit}>
      {header}
      <div
        className={cn(
          "grid border border-border [--search-control-height:4.25rem]",
          stackedAction
            ? "grid-cols-1 has-[:focus-visible]:[&>[data-slot=button]]:border-t-transparent"
            : "grid-cols-[minmax(0,1fr)_var(--search-side-column)] max-[48rem]:grid-cols-[minmax(0,1fr)_7.5rem] has-[:focus-visible]:[&>[data-slot=button]]:border-l-transparent",
          multiline && "min-h-32"
        )}
        data-action-placement={actionPlacement}
      >
        <label className="sr-only" htmlFor={`${name}-field`}>
          {fieldLabel}
        </label>
        <div
          className={cn(
            "relative min-w-0 before:pointer-events-none before:absolute before:inset-0 before:z-20 before:border before:border-transparent before:content-[''] has-[:focus-visible]:before:border-ring",
            multiline && "min-h-32"
          )}
        >
          {multiline ? (
            <textarea
              className="block min-h-32 w-full resize-y border-0 bg-transparent px-[clamp(1rem,2vw,1.5rem)] py-5 font-semibold text-foreground text-xl tracking-[-0.035em] outline-none placeholder:font-medium placeholder:text-muted-foreground/72 focus-visible:outline-none"
              id={`${name}-field`}
              maxLength={maxLength}
              name={name}
              onChange={change}
              placeholder={placeholder}
              ref={captureField}
              value={value}
            />
          ) : (
            <input
              autoComplete="off"
              className="h-[var(--search-control-height)] w-full border-0 bg-transparent px-[clamp(1rem,2vw,1.5rem)] py-0 font-semibold text-foreground text-xl leading-none tracking-[-0.035em] outline-none placeholder:text-muted-foreground/72 focus-visible:outline-none"
              id={`${name}-field`}
              maxLength={maxLength}
              name={name}
              onChange={change}
              placeholder={placeholder}
              ref={captureField}
              type={activeTool === "marks" ? "search" : "text"}
              value={value}
            />
          )}
        </div>
        <Button
          className={cn(
            "h-full min-h-[var(--search-control-height)] w-full rounded-none border-0 border-border px-[clamp(1.5rem,3vw,2.5rem)] text-[clamp(1.125rem,1.5vw,1.4rem)] shadow-none before:rounded-none",
            stackedAction ? "min-h-16 border-t" : "border-l"
          )}
          data-slot="button"
          loading={loading}
          size="xl"
          type="submit"
        >
          {displayedActionLabel}
        </Button>
        <p aria-live="polite" className="sr-only" role="status">
          {showInvalidAction ? invalidActionLabel : null}
        </p>
      </div>
    </form>
  );
}

function SearchToolLink({
  active,
  href,
  icon,
  label,
  onNavigate,
}: {
  active: boolean;
  href: string;
  icon: (typeof tools)[number]["icon"];
  label: string;
  onNavigate: (href: string) => void;
}) {
  const navigate = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      onNavigate(href);
      window.scrollTo(0, 0);
    },
    [href, onNavigate]
  );
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center justify-center gap-2 border-border border-r px-3 text-center text-base text-muted-foreground no-underline last:border-r-0 hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2",
        active && "bg-accent text-foreground"
      )}
      href={href}
      onClick={navigate}
    >
      <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={icon} />
      {label}
    </a>
  );
}
