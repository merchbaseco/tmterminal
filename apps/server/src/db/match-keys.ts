// The ICU collation makes the regex classes Unicode-aware whatever the database locale is.
export function foldedMatchKeySql(value: string) {
  const lowered = `lower(normalize(btrim(${value}), NFKC) collate "und-x-icu")`;
  const withoutApostrophes = `regexp_replace(${lowered}, '[''‘’ʼ]', '', 'g')`;
  const spaced = `regexp_replace(${withoutApostrophes}, '[[:punct:][:space:]]+', ' ', 'g')`;
  return `btrim(${spaced}, ' ') collate "default"`;
}
