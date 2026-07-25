import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../../server/src/api/router.ts";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type SearchPreferences = RouterOutputs["account"]["preferences"]["get"];

export const defaultSearchPreferences = {
  defaultMatch: "both",
  defaultRegistered: "all",
  defaultSort: "relevance",
  defaultStatus: "all",
  defaultType: "all",
  pageSize: 25,
  resultDensity: "compact",
} as const satisfies SearchPreferences;
