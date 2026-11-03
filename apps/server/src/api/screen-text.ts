import type {
  MarkSummary,
  MarksService,
  MatchTextsInput,
  MatchTextsResult,
  ScreenTextInput,
  ScreenTextResult,
  ScreenTextsResult,
} from "./contracts.ts";

// Screening is text matching without source positions: each matching trademark once per text.
export async function screenTexts(
  marks: Pick<MarksService, "match">,
  input: ScreenTextInput | MatchTextsInput
): Promise<ScreenTextResult | ScreenTextsResult> {
  if ("texts" in input) {
    const result = await marks.match(input);
    return {
      meta: result.meta,
      texts: result.texts.map((text) => ({
        id: text.id,
        trademarks: uniqueTrademarks(text.matches),
      })),
    };
  }
  const result = await marks.match({
    singular: input.singular,
    texts: [{ id: "text", text: input.text }],
    type: input.type,
  });
  return {
    meta: result.meta,
    trademarks: uniqueTrademarks(result.texts.flatMap((text) => text.matches)),
  };
}

function uniqueTrademarks(matches: MatchTextsResult["texts"][number]["matches"]) {
  const trademarks: MarkSummary[] = [];
  const serialNumbers = new Set<string>();

  for (const match of matches) {
    for (const trademark of match.trademarks) {
      if (!serialNumbers.has(trademark.serialNumber)) {
        serialNumbers.add(trademark.serialNumber);
        trademarks.push(trademark);
      }
    }
  }

  return trademarks;
}
