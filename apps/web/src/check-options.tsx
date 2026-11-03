import { type ChangeEvent, useCallback, useId } from "react";

import { type MarkTypeFilter, markTypeOptions } from "./mark-type-options.ts";
import { SearchOptionSelect } from "./search-option-select.tsx";

export interface CheckOptionValues {
  singular: boolean;
  type: MarkTypeFilter;
}

export const defaultCheckOptions = {
  singular: true,
  type: "all",
} as const satisfies CheckOptionValues;

// The options a submitted check ran with, which back navigation and drill-downs reuse.
export function submittedCheckOptions(
  input: Partial<CheckOptionValues> | undefined,
  current: CheckOptionValues
): CheckOptionValues {
  return input
    ? {
        singular: input.singular ?? defaultCheckOptions.singular,
        type: input.type ?? defaultCheckOptions.type,
      }
    : current;
}

// Check Text and Bulk Check expose the screening inputs beside `text` and `queries`: Singular
// (on, like the API) and Type. Search keeps Singular in its Match group, off unless asked.
export function CheckOptions({
  onChange,
  value,
}: {
  onChange: (value: CheckOptionValues) => void;
  value: CheckOptionValues;
}) {
  const labelId = useId();
  const changeSingular = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, singular: event.target.checked }),
    [onChange, value]
  );
  const changeType = useCallback(
    (type: MarkTypeFilter) => onChange({ ...value, type }),
    [onChange, value]
  );
  return (
    <section
      aria-label="Check options"
      className="grid grid-cols-[minmax(0,1fr)_var(--search-side-column)] border border-border border-t-0 max-[48rem]:grid-cols-1 [&_[name=type]]:border-r-0 max-[48rem]:[&_[name=type]]:border-b-0 min-[48rem]:[&_[name=type]]:border-l"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: Matches the Search Match group, which a fieldset legend would push off its baseline. */}
      <div
        aria-labelledby={labelId}
        className="grid min-h-16 min-w-0 grid-cols-[auto_minmax(0,1fr)] content-center items-center gap-x-4 gap-y-1 px-4 py-3 max-[48rem]:border-border max-[48rem]:border-b [&_input]:accent-primary"
        role="group"
      >
        <span className="utility-label col-span-full text-muted-foreground" id={labelId}>
          Match
        </span>
        <label className="flex items-center gap-2 font-semibold text-base">
          <input
            checked={value.singular}
            name="singular"
            onChange={changeSingular}
            type="checkbox"
          />
          Singular
        </label>
        <span className="min-w-0 text-muted-foreground text-sm">
          Plural words also match singular marks: kitten nuggets finds KITTEN NUGGET.
        </span>
      </div>
      <SearchOptionSelect
        label="Type"
        name="type"
        onValueChange={changeType}
        options={markTypeOptions}
        value={value.type}
      />
    </section>
  );
}
