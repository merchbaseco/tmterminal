import { expect, test } from "bun:test";

import type { MarkSummary, MatchTextsInput, MatchTextsResult } from "../../src/api/contracts.ts";
import { screenTexts } from "../../src/api/screen-text.ts";

const first = { serialNumber: "70000001", wordMark: "TERMINAL CLUB" } as MarkSummary;
const second = { serialNumber: "70000002", wordMark: "CLUB" } as MarkSummary;

function matcher(result: MatchTextsResult) {
  const inputs: MatchTextsInput[] = [];
  return {
    inputs,
    marks: {
      match: (input: MatchTextsInput) => {
        inputs.push(input);
        return Promise.resolve(result);
      },
    },
  };
}

test("screens one text as first-seen unique trademarks", async () => {
  const { inputs, marks } = matcher({
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
  });

  expect(
    await screenTexts(marks, { singular: false, text: "Terminal Club shirt", type: "text" })
  ).toEqual({
    meta: { dataVersion: "7" },
    trademarks: [first, second],
  });
  expect(inputs).toEqual([
    { singular: false, texts: [{ id: "text", text: "Terminal Club shirt" }], type: "text" },
  ]);
});

test("screens each named text as its own first-seen unique trademarks", async () => {
  const input = {
    singular: true,
    texts: [
      { id: "a", text: "Terminal Club shirt" },
      { id: "b", text: "Club" },
      { id: "c", text: "mug" },
    ],
    type: "all",
  } satisfies MatchTextsInput;
  const { inputs, marks } = matcher({
    meta: { dataVersion: "7" },
    texts: [
      {
        id: "a",
        matches: [
          { end: 13, start: 0, trademarks: [first, second] },
          { end: 13, start: 9, trademarks: [second] },
        ],
        text: "Terminal Club shirt",
      },
      { id: "b", matches: [{ end: 4, start: 0, trademarks: [second] }], text: "Club" },
      { id: "c", matches: [], text: "mug" },
    ],
  });

  expect(await screenTexts(marks, input)).toEqual({
    meta: { dataVersion: "7" },
    texts: [
      { id: "a", trademarks: [first, second] },
      { id: "b", trademarks: [second] },
      { id: "c", trademarks: [] },
    ],
  });
  expect(inputs).toEqual([input]);
});
