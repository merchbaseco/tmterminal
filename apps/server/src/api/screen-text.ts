import type { MarkSummary, MatchTextsResult, ScreenTextResult } from "./contracts.ts";

export function summarizeScreenedText(result: MatchTextsResult): ScreenTextResult {
  const trademarks: MarkSummary[] = [];
  const serialNumbers = new Set<string>();

  for (const text of result.texts) {
    for (const match of text.matches) {
      for (const trademark of match.trademarks) {
        if (!serialNumbers.has(trademark.serialNumber)) {
          serialNumbers.add(trademark.serialNumber);
          trademarks.push(trademark);
        }
      }
    }
  }

  return { meta: result.meta, trademarks };
}
