import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons-pro/core-stroke-rounded";
import { useCallback } from "react";

import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";

interface PreferenceOption<T extends string> {
  label: string;
  value: T;
}

export function AccountPreferenceSelect<T extends string>({
  disabled = false,
  label,
  name,
  onValueChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  name: string;
  onValueChange: (value: T) => void;
  options: readonly PreferenceOption<T>[];
  value: T;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const changeValue = useCallback(
    (nextValue: string) => onValueChange(nextValue as T),
    [onValueChange]
  );

  if (!selected) {
    return null;
  }

  return (
    <Menu>
      <MenuTrigger
        aria-label={`${label}: ${selected.label}`}
        className="group flex size-full min-h-20 min-w-0 cursor-pointer select-none items-center justify-between gap-3 rounded-none border-0 bg-transparent px-4 py-3 text-left font-semibold text-base text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 data-popup-open:bg-accent max-[40rem]:min-h-14"
        disabled={disabled}
        name={name}
        type="button"
      >
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {selected.label}
        </span>
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-[120ms] ease-out group-data-popup-open:rotate-180 sm:size-3.5"
          icon={ArrowDown01Icon}
        />
      </MenuTrigger>
      <MenuPopup
        align="end"
        className="w-[var(--anchor-width)] min-w-44 max-w-[calc(100vw-2rem)] overflow-hidden rounded-none bg-background shadow-none before:hidden [&>div]:p-0"
        sideOffset={0}
      >
        <MenuRadioGroup onValueChange={changeValue} value={value}>
          {options.map((option) => (
            <MenuRadioItem
              className="min-h-11 whitespace-nowrap rounded-none border-border border-b px-4 py-2.5 text-base last:border-b-0 data-checked:data-highlighted:bg-primary data-checked:bg-primary data-highlighted:bg-accent data-checked:text-primary-foreground sm:text-base"
              closeOnClick
              key={option.value}
              value={option.value}
            >
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
