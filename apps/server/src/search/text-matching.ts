const unicodeWordTokens = /[\p{Letter}\p{Mark}\p{Number}]+/gu;

export interface TextSpan {
  end: number;
  normalizedTerm: string;
  start: number;
}

function textTokens(text: string) {
  return Array.from(text.matchAll(unicodeWordTokens), (match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));
}

export function countTextTokens(text: string) {
  return textTokens(text).length;
}

function allTextSpans(text: string) {
  const tokens = textTokens(text);
  const spans: TextSpan[] = [];

  for (const [start, first] of tokens.entries()) {
    for (const last of tokens.slice(start)) {
      spans.push({
        end: last.end,
        normalizedTerm: text
          .slice(first.start, last.end)
          .normalize("NFKC")
          .toLocaleLowerCase("und"),
        start: first.start,
      });
    }
  }

  return spans;
}

export function candidateTextTerms(text: string) {
  return Array.from(new Set(allTextSpans(text).map(({ normalizedTerm }) => normalizedTerm)));
}

export function findTextSpans(text: string, normalizedTerms: ReadonlySet<string>): TextSpan[] {
  const spans = allTextSpans(text).filter(({ normalizedTerm }) =>
    normalizedTerms.has(normalizedTerm)
  );

  return spans.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.normalizedTerm.localeCompare(right.normalizedTerm)
  );
}
