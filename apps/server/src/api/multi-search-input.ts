import { z } from "zod";

import type { MultiSearchInput } from "./contracts.ts";

export const multiSearchInputSchema = z.object({
  classes: z.array(z.string().regex(/^(?:\d{3}|[AB])$/)).max(45).default([]),
  expectedCorpusVersion: z.string().regex(/^\d+$/).optional(),
  limit: z.literal(25).default(25),
  match: z.enum(["exact", "partial", "both"]).default("both"),
  mode: z.literal("multi"),
  offset: z.int().nonnegative().default(0),
  query: z.string().trim().min(1).max(200),
  registered: z.enum(["all", "yes", "no"]).default("all"),
  sort: z.enum(["relevance", "newest-activity", "oldest-activity"]).default("relevance"),
  status: z.enum(["all", "live", "dead"]).default("all"),
  type: z.enum(["all", "design", "typeset", "text", "other"]).default("all"),
}).superRefine((input, context) => {
  if (input.offset > 0 && !input.expectedCorpusVersion) {
    context.addIssue({
      code: "custom",
      message: "expectedCorpusVersion is required for continuation requests",
      path: ["expectedCorpusVersion"],
    });
  }
}) satisfies z.ZodType<MultiSearchInput>;
