const unicodeWordTokens = /[\p{Letter}\p{Mark}\p{Number}]+/gu;

export function splitSearchTerms(query: string) {
  const tokens = query.normalize("NFKC").match(unicodeWordTokens) ?? [];
  const terms: string[] = [];
  const { length: tokenCount } = tokens;

  for (let length = tokenCount; length > 0; length -= 1) {
    for (let start = 0; start + length <= tokenCount; start += 1) {
      terms.push(tokens.slice(start, start + length).join(" "));
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
