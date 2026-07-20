import { z } from "zod";

import { countTextTokens } from "../search/text-matching.ts";
import type { LatestInput, MatchTextInput } from "./contracts.ts";

const maximumMatchTextCodeUnits = 4096;
const maximumMatchTextTokens = 128;

export const latestInputSchema = z
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
  }) satisfies z.ZodType<LatestInput>;

export const matchTextInputSchema = z
  .object({
    text: z.string().superRefine(validateMatchText),
    type: z.enum(["all", "design", "typeset", "text", "other"]).default("all"),
  })
  .strict() satisfies z.ZodType<MatchTextInput>;

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
