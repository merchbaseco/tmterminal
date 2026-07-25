import { z } from "zod";

export const searchPreferencesSchema = z
  .object({
    defaultMatch: z.enum(["both", "exact", "partial"]),
    defaultSort: z.enum(["relevance", "newest-activity", "oldest-activity"]),
    defaultStatus: z.enum(["all", "live", "dead"]),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
    resultDensity: z.enum(["compact", "comfortable"]),
  })
  .strict();

export type SearchPreferences = z.infer<typeof searchPreferencesSchema>;

export const defaultSearchPreferences = {
  defaultMatch: "both",
  defaultSort: "relevance",
  defaultStatus: "all",
  pageSize: 25,
  resultDensity: "compact",
} as const satisfies SearchPreferences;
