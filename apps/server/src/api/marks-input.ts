import { z } from "zod";

import { countTextTokens } from "../search/text-matching.ts";
import type { ListMarksInput, MatchTextsInput, ScreenQueriesInput } from "./contracts.ts";

const maximumMatchTextCodeUnits = 4096;
const maximumMatchTextTokens = 128;
const maximumMatchTexts = 100;
const maximumScreenQueries = 100;
const identifierSchema = z.string().trim().min(1).max(100);

export const listMarksInputSchema = z
  .object({
    expectedDataVersion: z.string().regex(/^\d+$/).optional(),
    limit: z.literal(25).default(25),
    offset: z.int().nonnegative().default(0),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.offset > 0 && !input.expectedDataVersion) {
      context.addIssue({
        code: "custom",
        message: "expectedDataVersion is required for continuation requests",
        path: ["expectedDataVersion"],
      });
    }
  }) satisfies z.ZodType<ListMarksInput>;

export const markIdentitySchema = z.union([
  z.object({ serialNumber: z.string().regex(/^\d{8}$/) }).strict(),
  z.object({ registrationNumber: z.string().regex(/^\d{7}$/) }).strict(),
]);

export const matchTextsInputSchema = z
  .object({
    texts: z
      .array(
        z
          .object({
            id: identifierSchema,
            text: z.string().superRefine(validateMatchText),
          })
          .strict()
      )
      .min(1)
      .max(maximumMatchTexts),
    type: z.enum(["all", "design", "typeset", "text", "other"]).default("all"),
  })
  .strict()
  .superRefine((input, context) =>
    validateUniqueIds(input.texts, context)
  ) satisfies z.ZodType<MatchTextsInput>;

export const screenQueriesInputSchema = z
  .object({
    queries: z
      .array(
        z
          .object({
            id: identifierSchema,
            query: z.string().trim().min(1).max(200),
          })
          .strict()
      )
      .min(1)
      .max(maximumScreenQueries),
    type: z.enum(["all", "design", "typeset", "text", "other"]).default("all"),
  })
  .strict()
  .superRefine((input, context) =>
    validateUniqueIds(input.queries, context)
  ) satisfies z.ZodType<ScreenQueriesInput>;

function validateMatchText(text: string, context: z.RefinementCtx) {
  if (text.length > maximumMatchTextCodeUnits) {
    context.addIssue({
      code: "custom",
      message: `Text must contain at most ${maximumMatchTextCodeUnits} UTF-16 code units`,
    });
    return;
  }
  if (text.trim().length === 0) {
    context.addIssue({ code: "custom", message: "Text is required" });
  }
  if (countTextTokens(text) > maximumMatchTextTokens) {
    context.addIssue({
      code: "custom",
      message: `Text must contain at most ${maximumMatchTextTokens} Unicode word tokens`,
    });
  }
}

function validateUniqueIds(items: Array<{ id: string }>, context: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) {
      context.addIssue({
        code: "custom",
        message: "Ids must be unique",
        path: [index, "id"],
      });
    }
    seen.add(item.id);
  }
}
