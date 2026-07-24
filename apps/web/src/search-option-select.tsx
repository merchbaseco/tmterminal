import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons-pro/core-stroke-rounded";
import { useCallback } from "react";

import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";

interface SearchOption<T extends string> {
  label: string;
  value: T;
}

function SelectChevron() {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className="col-start-2 row-start-2 size-3.5 shrink-0 text-muted-foreground transition-transform duration-[120ms] ease-out group-data-[popup-open]:rotate-180"
      icon={ArrowDown01Icon}
    />
  );
}

export function SearchOptionSelect<T extends string>({
  label,
  name,
  onValueChange,
  options,
  value,
}: {
  label: string;
  name: string;
  onValueChange: (value: T) => void;
  options: readonly SearchOption<T>[];
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
        className="group grid min-h-16 w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] content-center gap-x-3 gap-y-1 border-0 border-border border-r bg-transparent px-4 py-3 text-left text-inherit hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 data-[popup-open]:bg-accent max-[48rem]:border-b"
        name={name}
      >
        <span className="utility-label col-span-full text-muted-foreground">{label}</span>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-base text-foreground">
          {selected.label}
        </span>
        <SelectChevron />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className="w-max min-w-[max(var(--anchor-width),11rem)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-none bg-background shadow-none before:hidden [&>div]:p-0"
        sideOffset={0}
      >
        <MenuRadioGroup onValueChange={changeValue} value={value}>
          {options.map((option) => (
            <MenuRadioItem
              className="min-h-11 whitespace-nowrap rounded-none border-border border-b px-4 py-2.5 last:border-b-0 data-[checked]:data-[highlighted]:bg-primary data-[checked]:bg-primary data-[highlighted]:bg-accent data-[checked]:text-primary-foreground"
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
