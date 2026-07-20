import { expect, test } from "bun:test";

import { findTextSpans } from "../../src/search/text-matching.ts";

test("finds every overlapping Unicode term with JavaScript UTF-16 offsets", () => {
  const text = "🐢 Cafe\u0301 Society—society";

  const spans = findTextSpans(text, new Set(["café", "café society", "society"]));

  expect(spans).toEqual([
    { end: 16, normalizedTerm: "café society", start: 3 },
    { end: 8, normalizedTerm: "café", start: 3 },
    { end: 16, normalizedTerm: "society", start: 9 },
    { end: 24, normalizedTerm: "society", start: 17 },
  ]);
  expect(spans.map(({ end, start }) => text.slice(start, end))).toEqual([
    "Cafe\u0301 Society",
    "Cafe\u0301",
    "Society",
    "society",
  ]);
});

test("normalizes compatibility characters without changing source offsets", () => {
  const text = "ᴬ shirt";

  expect(findTextSpans(text, new Set(["a", "a shirt"]))).toEqual([
    { end: 7, normalizedTerm: "a shirt", start: 0 },
    { end: 1, normalizedTerm: "a", start: 0 },
  ]);
});
