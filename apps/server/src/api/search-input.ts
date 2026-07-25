import { z } from "zod";

import { splitSearchTerms, wildcardPatternIssue } from "../search/search-patterns.ts";
import type { SearchInput } from "./contracts.ts";

const searchInputBase = {
  expectedDataVersion: z.string().regex(/^\d+$/).optional(),
  limit: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  offset: z.int().nonnegative().default(0),
  query: z.string().trim().min(1).max(200),
  registered: z.enum(["all", "yes", "no"]).default("all"),
  sort: z.enum(["relevance", "newest-activity", "oldest-activity"]).default("relevance"),
  status: z.enum(["all", "live", "dead"]).default("all"),
  type: z.enum(["all", "design", "typeset", "text", "other"]).default("all"),
};

export const searchInputSchema = z
  .discriminatedUnion("mode", [
    z
      .object({
        ...searchInputBase,
        match: z.enum(["exact", "partial", "both"]).default("both"),
        mode: z.literal("multi"),
      })
      .strict(),
    z
      .object({ ...searchInputBase, match: z.never().optional(), mode: z.literal("split") })
      .strict(),
    z
      .object({ ...searchInputBase, match: z.never().optional(), mode: z.literal("wildcard") })
      .strict(),
  ])
  .superRefine((input, context) => {
    if (input.offset > 0 && !input.expectedDataVersion) {
      context.addIssue({
        code: "custom",
        message: "expectedDataVersion is required for continuation requests",
        path: ["expectedDataVersion"],
      });
    }
    if (input.mode === "split" && splitSearchTerms(input.query).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Split search requires at least one word token",
        path: ["query"],
      });
    }
    if (input.mode === "wildcard") {
      const issue = wildcardPatternIssue(input.query);
      if (issue) {
        context.addIssue({ code: "custom", message: issue, path: ["query"] });
      }
    }
  }) satisfies z.ZodType<SearchInput>;
