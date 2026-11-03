import { type ChangeEvent, useCallback, useId } from "react";

// Check Text and Bulk Check screen with singular on, like the API; Search keeps it in its Match
// group, off unless asked.
export function SingularOption({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onCheckedChange(event.target.checked),
    [onCheckedChange]
  );
  return (
    <section aria-label="Check options" className="border border-border border-t-0">
      {/* biome-ignore lint/a11y/useSemanticElements: Matches the Search Match group, which a fieldset legend would push off its baseline. */}
      <div
        aria-labelledby={labelId}
        className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)] content-center items-center gap-x-4 gap-y-1 px-4 py-3 [&_input]:accent-primary"
        role="group"
      >
        <span className="utility-label col-span-full text-muted-foreground" id={labelId}>
          Match
        </span>
        <label className="flex items-center gap-2 font-semibold text-base">
          <input checked={checked} name="singular" onChange={change} type="checkbox" />
          Singular
        </label>
        <span className="min-w-0 text-muted-foreground text-sm">
          Plural words also match singular marks: kitten nuggets finds KITTEN NUGGET.
        </span>
      </div>
    </section>
  );
}
