import { useCallback } from "react";

import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";

interface SearchOption<T extends string> {
  label: string;
  value: T;
}

function SelectChevron() {
  return (
    <svg
      aria-hidden="true"
      className="search-select-chevron"
      fill="none"
      height="5"
      viewBox="0 0 8 5"
      width="8"
    >
      <path d="M.5.5 4 4 7.5.5" stroke="currentColor" />
    </svg>
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
        className="search-option-select"
        name={name}
      >
        <span className="search-option-label">{label}</span>
        <span className="search-option-value">{selected.label}</span>
        <SelectChevron />
      </MenuTrigger>
      <MenuPopup align="start" className="search-option-menu" sideOffset={0}>
        <MenuRadioGroup onValueChange={changeValue} value={value}>
          {options.map((option) => (
            <MenuRadioItem
              className="search-option-menu-item"
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
