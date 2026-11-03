import { expect, test } from "bun:test";

import { splitSearchTerms } from "../../src/search/search-patterns.ts";

test("Split terms keep apostrophes and other in-word punctuation from the source", () => {
  expect(splitSearchTerms("  It's fine—really ")).toEqual([
    "It's fine—really",
    "It's fine",
    "s fine—really",
    "It's",
    "s fine",
    "fine—really",
    "It",
    "s",
    "fine",
    "really",
  ]);
});

test("Split terms are NFKC-normalized and empty for punctuation-only queries", () => {
  expect(splitSearchTerms("ＡＢＣ")).toEqual(["ABC"]);
  expect(splitSearchTerms("—!?")).toEqual([]);
});
