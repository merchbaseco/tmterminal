import { expect, test } from "bun:test";

import type { MarkSummary, MatchTextsResult } from "../../src/api/contracts.ts";
import { summarizeScreenedText } from "../../src/api/screen-text.ts";

const first = { serialNumber: "70000001", wordMark: "TERMINAL CLUB" } as MarkSummary;
const second = { serialNumber: "70000002", wordMark: "CLUB" } as MarkSummary;

test("summarizes screened text as first-seen unique trademarks", () => {
  const result = {
    meta: { dataVersion: "7" },
    texts: [
      {
        id: "text",
        matches: [
          { end: 13, start: 0, trademarks: [first, second] },
          { end: 13, start: 9, trademarks: [second] },
        ],
        text: "Terminal Club shirt",
      },
    ],
  } satisfies MatchTextsResult;

  expect(summarizeScreenedText(result)).toEqual({
    meta: { dataVersion: "7" },
    trademarks: [first, second],
  });
});
