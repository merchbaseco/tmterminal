// The ICU collation makes the regex classes Unicode-aware whatever the database locale is.
export function foldedMatchKeySql(value: string) {
  const lowered = `lower(normalize(btrim(${value}), NFKC) collate "und-x-icu")`;
  const withoutApostrophes = `regexp_replace(${lowered}, '[''‘’ʼ]', '', 'g')`;
  const spaced = `regexp_replace(${withoutApostrophes}, '[[:punct:][:space:]]+', ' ', 'g')`;
  return `btrim(${spaced}, ' ') collate "default"`;
}

// singular_match_key (migration 0033) makes every plural word of a folded key singular and folds
// -ie into -y, so KITTEN NUGGET and "kitten nuggets" share a key. Its rules are Factory's
// tm_forms.numberless; test/integration/singular-match-key.test.ts holds the two in parity.
export function matchKeySql(folded: string, singular: boolean) {
  return singular ? `singular_match_key(${folded})` : folded;
}
