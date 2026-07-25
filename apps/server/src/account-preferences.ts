import { z } from "zod";

export const searchPreferencesSchema = z
  .object({
    defaultMatch: z.enum(["both", "exact", "partial"]),
    defaultRegistered: z.enum(["all", "yes", "no"]),
    defaultSort: z.enum(["relevance", "newest-activity", "oldest-activity"]),
    defaultStatus: z.enum(["all", "live", "dead"]),
    defaultType: z.enum(["all", "design", "typeset", "text"]),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
    resultDensity: z.enum(["compact", "comfortable"]),
  })
  .strict();

export type SearchPreferences = z.infer<typeof searchPreferencesSchema>;

export const defaultSearchPreferences = {
  defaultMatch: "both",
  defaultRegistered: "all",
  defaultSort: "relevance",
  defaultStatus: "all",
  defaultType: "all",
  pageSize: 25,
  resultDensity: "compact",
} as const satisfies SearchPreferences;
