import { z } from "zod";

import type { ReportInput } from "./contracts.ts";

const common = {
  expectedDataVersion: z.string().regex(/^\d+$/).optional(),
  limit: z.literal(25).default(25),
  offset: z.int().nonnegative().default(0),
  registered: z.enum(["all", "yes", "no"]).default("all"),
  sort: z.enum(["newest-activity", "oldest-activity"]).default("newest-activity"),
  status: z.enum(["all", "live", "dead"]).default("all"),
  type: z.enum(["all", "design", "typeset", "text", "other"]).default("all"),
};
const windowed = {
  ...common,
  expectedFrom: z.iso.date().optional(),
  expectedTo: z.iso.date().optional(),
};

export const reportInputSchema = z
  .discriminatedUnion("event", [
    z
      .object({ ...windowed, event: z.literal("filed"), window: z.literal("previous-week") })
      .strict(),
    z
      .object({ ...windowed, event: z.literal("registered"), window: z.literal("previous-week") })
      .strict(),
    z.object({ ...common, event: z.literal("published-for-opposition") }).strict(),
  ])
  .superRefine((input, context) => {
    if (input.offset > 0 && !input.expectedDataVersion) {
      context.addIssue({
        code: "custom",
        message: "expectedDataVersion is required for continuation requests",
        path: ["expectedDataVersion"],
      });
    }
    if (input.event === "published-for-opposition") {
      return;
    }
    const hasCompleteWindow = Boolean(input.expectedFrom && input.expectedTo);
    const hasAnyWindow = Boolean(input.expectedFrom || input.expectedTo);
    if (
      hasAnyWindow !== hasCompleteWindow ||
      Boolean(input.expectedDataVersion) !== hasCompleteWindow
    ) {
      context.addIssue({
        code: "custom",
        message: "expectedDataVersion, expectedFrom, and expectedTo must be supplied together",
        path: ["expectedFrom"],
      });
    }
  }) satisfies z.ZodType<ReportInput>;
