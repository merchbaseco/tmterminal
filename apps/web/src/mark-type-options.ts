export type MarkTypeFilter = "all" | "design" | "typeset" | "text" | "other";

export const markTypeOptions = [
  { label: "All", value: "all" },
  { label: "Design", value: "design" },
  { label: "Typeset", value: "typeset" },
  { label: "Text", value: "text" },
  { label: "Other", value: "other" },
] as const satisfies ReadonlyArray<{ label: string; value: MarkTypeFilter }>;

export function isMarkTypeFilter(value: string | null): value is MarkTypeFilter {
  return markTypeOptions.some((option) => option.value === value);
}
