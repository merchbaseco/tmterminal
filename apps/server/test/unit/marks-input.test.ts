import { expect, test } from "bun:test";

import { latestInputSchema, matchTextInputSchema } from "../../src/api/marks-input.ts";

test("latest continuations require the expected live data version", () => {
  expect(latestInputSchema.safeParse({ offset: 25 }).success).toBe(false);
  expect(latestInputSchema.parse({ expectedDataVersion: "7", offset: 25 })).toEqual({
    expectedDataVersion: "7",
    limit: 25,
    offset: 25,
  });
});

test("text matching preserves source offsets and accepts only its mark type filter", () => {
  const text = "  Cafe\u0301 turtle\n";

  expect(matchTextInputSchema.parse({ text })).toEqual({ text, type: "all" });
  expect(matchTextInputSchema.safeParse({ status: "dead", text }).success).toBe(false);
  expect(matchTextInputSchema.safeParse({ text: "  \n" }).success).toBe(false);
});

test("text matching rejects listing text beyond its explicit input boundaries", () => {
  const acceptedCodeUnits = "🐢".repeat(2048);
  const acceptedTokens = Array.from({ length: 128 }, () => "東京").join(" ");
  const rejectedTokens = `${acceptedTokens} 東京`;

  expect(matchTextInputSchema.safeParse({ text: acceptedCodeUnits }).success).toBe(true);
  expect(matchTextInputSchema.safeParse({ text: `${acceptedCodeUnits}a` }).error?.issues).toEqual([
    expect.objectContaining({ message: "Text must contain at most 4096 UTF-16 code units" }),
  ]);
  expect(matchTextInputSchema.safeParse({ text: acceptedTokens }).success).toBe(true);
  expect(matchTextInputSchema.safeParse({ text: rejectedTokens }).error?.issues).toEqual([
    expect.objectContaining({ message: "Text must contain at most 128 Unicode word tokens" }),
  ]);
});
