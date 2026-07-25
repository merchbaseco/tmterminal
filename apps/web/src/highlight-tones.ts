export const highlightTones = ["lime", "cyan", "orange", "pink", "violet", "mint"] as const;

export type HighlightTone = (typeof highlightTones)[number];

export const highlightToneStyles: Record<
  HighlightTone,
  { active: string; fill: string; indicator: string }
> = {
  cyan: {
    active: "stroke-primary-foreground stroke-[1.5px]",
    fill: "fill-highlight-cyan",
    indicator: "bg-highlight-cyan",
  },
  lime: {
    active: "stroke-primary-foreground stroke-[1.5px]",
    fill: "fill-highlight-lime",
    indicator: "bg-highlight-lime",
  },
  mint: {
    active: "stroke-primary-foreground stroke-[1.5px]",
    fill: "fill-highlight-mint",
    indicator: "bg-highlight-mint",
  },
  orange: {
    active: "stroke-primary-foreground stroke-[1.5px]",
    fill: "fill-highlight-orange",
    indicator: "bg-highlight-orange",
  },
  pink: {
    active: "stroke-primary-foreground stroke-[1.5px]",
    fill: "fill-highlight-pink",
    indicator: "bg-highlight-pink",
  },
  violet: {
    active: "stroke-primary-foreground stroke-[1.5px]",
    fill: "fill-highlight-violet",
    indicator: "bg-highlight-violet",
  },
};
