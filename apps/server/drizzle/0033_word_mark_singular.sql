-- Factory's tm_forms.numberless over a folded key: a word that reads as a regular plural loses it
-- (-ies to -y, -ches -shes -xes -zes -sses to their stem, else -s), then -ie folds into -y.
-- test/integration/singular-match-key.test.ts holds this function in parity with tm_forms.py.
CREATE FUNCTION "singular_match_key"(folded text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  select coalesce(string_agg(
    case when char_length(singular) > 3 and singular like '%ie' then left(singular, -2) || 'y'
      else singular end,
    ' ' order by position
  ), '')
  from (
    select position, case
      when char_length(word) <= 3 or word not like '%s' or word ~ '(ss|us|is)$'
        or word in (
          'always', 'perhaps', 'this', 'thus', 'was', 'has', 'does', 'its', 'lets', 'yes',
          'less', 'unless', 'across', 'towards', 'whereas', 'besides', 'sometimes',
          'nevertheless', 'hers', 'ours', 'yours', 'news'
        ) then word
      when word like '%ies' then left(word, -3) || 'y'
      when word ~ '(ch|sh|x|z|ss)es$' then left(word, -2)
      else left(word, -1)
    end as singular
    from unnest(string_to_array(folded, ' ')) with ordinality as words(word, position)
  ) singular_words
$$;--> statement-breakpoint
CREATE INDEX "mark_word_mark_singular_idx" ON "mark" USING hash (singular_match_key("word_mark_folded"));--> statement-breakpoint
CREATE INDEX "mark_word_mark_singular_trgm_idx" ON "mark" USING gin (singular_match_key("word_mark_folded") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "mark_live_word_mark_singular_idx" ON "mark" USING hash (singular_match_key("word_mark_folded")) WHERE "mark"."search_status" = 'live';--> statement-breakpoint
CREATE INDEX "mark_live_word_mark_singular_trgm_idx" ON "mark" USING gin (singular_match_key("word_mark_folded") gin_trgm_ops) WHERE "mark"."search_status" = 'live';