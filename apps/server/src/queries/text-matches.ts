import type postgres from "postgres";

import type { MarkSummary, MatchTextInput, MatchTextResult } from "../api/contracts.ts";
import { candidateTextTerms, findTextSpans } from "../search/text-matching.ts";
import { readDataSnapshot } from "./data-snapshot.ts";
import { markSummarySql, markTypeSql } from "./mark-page.ts";

interface Candidate extends MarkSummary {
  normalizedTerm: string;
}

export function matchText(database: postgres.Sql, input: MatchTextInput): Promise<MatchTextResult> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const snapshot = await readDataSnapshot(transaction);

    const terms = candidateTextTerms(input.text);
    const typePredicate = input.type === "all" ? "" : `and ${markTypeSql} = $2`;
    const values =
      input.type === "all" ? [JSON.stringify(terms)] : [JSON.stringify(terms), input.type];
    const candidates = await transaction.unsafe<Candidate[]>(
      `with terms as (
        select distinct lower(normalize(term, NFKC) collate "und-x-icu") collate "default" as value
        from jsonb_array_elements_text($1::text::jsonb) source_terms(term)
      )
      select ${markSummarySql}, m.word_mark_normalized as "normalizedTerm"
      from mark m join terms on terms.value = m.word_mark_normalized
      where m.search_status = 'live' ${typePredicate}
      order by m.word_mark_normalized, m.serial_number`,
      values
    );
    const candidatesByTerm = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const matches = candidatesByTerm.get(candidate.normalizedTerm) ?? [];
      matches.push(candidate);
      candidatesByTerm.set(candidate.normalizedTerm, matches);
    }
    const spans = findTextSpans(input.text, new Set(candidatesByTerm.keys()));

    return {
      matches: spans.flatMap(({ end, normalizedTerm, start }) => {
        const matchedCandidates = candidatesByTerm.get(normalizedTerm);
        if (!matchedCandidates) {
          throw new Error("Text match candidate group is unavailable");
        }
        return matchedCandidates.map((candidate) => {
          const { normalizedTerm: _normalizedTerm, ...mark } = candidate;
          return { end, mark, start };
        });
      }),
      meta: snapshot,
    };
  });
}
