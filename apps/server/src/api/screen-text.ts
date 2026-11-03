import type {
  MarkSummary,
  MatchTextsResult,
  ScreenTextResult,
  ScreenTextsResult,
} from "./contracts.ts";

export function summarizeScreenedText(result: MatchTextsResult): ScreenTextResult {
  return {
    meta: result.meta,
    trademarks: uniqueTrademarks(result.texts.flatMap((text) => text.matches)),
  };
}

export function summarizeScreenedTexts(result: MatchTextsResult): ScreenTextsResult {
  return {
    meta: result.meta,
    texts: result.texts.map((text) => ({
      id: text.id,
      trademarks: uniqueTrademarks(text.matches),
    })),
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
