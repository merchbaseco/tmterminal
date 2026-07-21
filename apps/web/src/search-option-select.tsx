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
      className="block size-3.5 shrink-0 text-muted-foreground transition-transform duration-[120ms] ease-out group-data-[popup-open]:rotate-180 max-[48rem]:col-start-2 max-[48rem]:row-start-2"
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
        className="group grid min-h-11 min-w-44 flex-auto cursor-pointer grid-cols-[auto_auto_auto] items-center gap-[0.65rem] border-0 border-border border-r bg-transparent px-4 py-[0.45rem] text-left font-[650] text-[0.75rem] text-inherit uppercase tracking-[0.09em] hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 data-[popup-open]:bg-accent max-[48rem]:min-h-14 max-[48rem]:w-full max-[48rem]:min-w-0 max-[48rem]:grid-cols-[minmax(0,1fr)_auto] max-[48rem]:content-start max-[48rem]:gap-x-3 max-[48rem]:gap-y-[0.35rem] max-[48rem]:border-r-0 max-[48rem]:border-b max-[48rem]:px-4 max-[48rem]:py-3"
        name={name}
      >
        <span className="max-[48rem]:col-span-full">{label}</span>
        <span className="whitespace-nowrap font-bold text-base text-foreground normal-case tracking-normal">
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
              className="min-h-11 whitespace-nowrap rounded-none border-border border-b px-4 py-[0.45rem] font-bold text-[0.75rem] uppercase tracking-[0.09em] last:border-b-0 data-[checked]:data-[highlighted]:bg-primary data-[checked]:bg-primary data-[highlighted]:bg-accent data-[checked]:text-primary-foreground"
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
