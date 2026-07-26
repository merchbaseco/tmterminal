import { expect, test } from "bun:test";

import {
  listMarksInputSchema,
  matchTextsInputSchema,
  screenQueriesInputSchema,
} from "../../src/api/marks-input.ts";
import { searchInputSchema } from "../../src/api/search-input.ts";

test("search accepts only supported account page sizes", () => {
  const input = { mode: "multi" as const, query: "terminal" };

  expect(searchInputSchema.parse({ ...input, limit: 50 }).limit).toBe(50);
  expect(searchInputSchema.parse({ ...input, limit: 100 }).limit).toBe(100);
  expect(searchInputSchema.safeParse({ ...input, limit: 75 }).success).toBe(false);
});

test("list continuations require the expected live data version", () => {
  expect(listMarksInputSchema.safeParse({ offset: 25 }).success).toBe(false);
  expect(listMarksInputSchema.parse({ expectedDataVersion: "7", offset: 25 })).toEqual({
    expectedDataVersion: "7",
    limit: 25,
    offset: 25,
  });
});

test("text matching preserves source offsets and accepts only its mark type filter", () => {
  const text = "  Cafe\u0301 terminal\n";

  expect(matchTextsInputSchema.parse({ texts: [{ id: "title", text }] })).toEqual({
    texts: [{ id: "title", text }],
    type: "all",
  });
  expect(
    matchTextsInputSchema.safeParse({ status: "dead", texts: [{ id: "title", text }] }).success
  ).toBe(false);
  expect(matchTextsInputSchema.safeParse({ texts: [{ id: "title", text: "  \n" }] }).success).toBe(
    false
  );
  expect(
    matchTextsInputSchema.safeParse({
      texts: [
        { id: "title", text },
        { id: "title", text: "duplicate" },
      ],
    }).success
  ).toBe(false);
});

test("text matching rejects listing text beyond its explicit input boundaries", () => {
  const acceptedCodeUnits = "🐢".repeat(2048);
  const acceptedTokens = Array.from({ length: 128 }, () => "東京").join(" ");
  const rejectedTokens = `${acceptedTokens} 東京`;

  expect(
    matchTextsInputSchema.safeParse({ texts: [{ id: "body", text: acceptedCodeUnits }] }).success
  ).toBe(true);
  expect(
    matchTextsInputSchema.safeParse({ texts: [{ id: "body", text: `${acceptedCodeUnits}a` }] })
      .error?.issues
  ).toEqual([
    expect.objectContaining({ message: "Text must contain at most 4096 UTF-16 code units" }),
  ]);
  expect(
    matchTextsInputSchema.safeParse({ texts: [{ id: "body", text: acceptedTokens }] }).success
  ).toBe(true);
  expect(
    matchTextsInputSchema.safeParse({ texts: [{ id: "body", text: rejectedTokens }] }).error?.issues
  ).toEqual([
    expect.objectContaining({ message: "Text must contain at most 128 Unicode word tokens" }),
  ]);
});

test("bulk screening accepts ordered unique phrase ids", () => {
  expect(
    screenQueriesInputSchema.parse({
      queries: [
        { id: "a", query: "TERMINAL CLUB" },
        { id: "b", query: "  café  " },
      ],
    })
  ).toEqual({
    queries: [
      { id: "a", query: "TERMINAL CLUB" },
      { id: "b", query: "café" },
    ],
    type: "all",
  });
  expect(
    screenQueriesInputSchema.safeParse({
      queries: [
        { id: "a", query: "one" },
        { id: "a", query: "two" },
      ],
    }).success
  ).toBe(false);
});
