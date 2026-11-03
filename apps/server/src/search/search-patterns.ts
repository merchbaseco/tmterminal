const unicodeWordTokens = /[\p{Letter}\p{Mark}\p{Number}]+/gu;

// Terms are source slices, not re-joined tokens, so "it's" stays "it's" for the folded match key.
export function splitSearchTerms(query: string) {
  const normalized = query.normalize("NFKC");
  const tokens = Array.from(normalized.matchAll(unicodeWordTokens), (match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));
  const terms: string[] = [];
  const { length: tokenCount } = tokens;

  for (let length = tokenCount; length > 0; length -= 1) {
    for (const [index, first] of tokens.slice(0, tokenCount - length + 1).entries()) {
      const last = tokens[index + length - 1];
      if (last) {
        terms.push(normalized.slice(first.start, last.end));
      }
    }
  }

  return terms;
}

export function wildcardPatternIssue(query: string) {
  const normalized = query.trim().normalize("NFKC");
  if (!normalized.includes("*")) {
    return null;
  }

  const longestLiteralWordRun = normalized
    .split("*")
    .flatMap((part) => part.match(/[\p{Letter}\p{Mark}\p{Number}]+/gu) ?? [])
    .reduce((longest, part) => Math.max(longest, Array.from(part).length), 0);
  return longestLiteralWordRun < 3
    ? "Wildcard patterns must contain at least three consecutive literal word characters"
    : null;
}
