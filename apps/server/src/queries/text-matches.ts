import type postgres from "postgres";

import type { MarkSummary, MatchTextsInput, MatchTextsResult } from "../api/contracts.ts";
import { candidateTextTerms, findTextSpans } from "../search/text-matching.ts";
import { readDataSnapshot } from "./data-snapshot.ts";
import { markSummarySql, markTypeSql } from "./mark-page.ts";

interface Candidate extends MarkSummary {
  normalizedTerm: string;
}

export function matchTexts(
  database: postgres.Sql,
  input: MatchTextsInput
): Promise<MatchTextsResult> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const snapshot = await readDataSnapshot(transaction);
    const candidatesByTerm = new Map<string, Candidate[]>();
    const queriedTerms = new Set<string>();
    const texts: MatchTextsResult["texts"] = [];

    // Bound candidate materialization to one validated document at a time. A document can
    // produce O(tokens²) spans, so combining the maximum 100 documents would amplify one
    // authenticated request into gigabytes of transient strings.
    for (const { id, text } of input.texts) {
      const terms = candidateTextTerms(text).filter((term) => !queriedTerms.has(term));
      for (const term of terms) {
        queriedTerms.add(term);
      }
      // biome-ignore lint/performance/noAwaitInLoops: Sequential reads keep O(tokens²) candidate materialization bounded to one document.
      const candidates = await readCandidates(transaction, terms, input.type);
      for (const candidate of candidates) {
        const matches = candidatesByTerm.get(candidate.normalizedTerm) ?? [];
        matches.push(candidate);
        candidatesByTerm.set(candidate.normalizedTerm, matches);
      }
      texts.push({
        id,
        matches: findTextSpans(text, new Set(candidatesByTerm.keys())).map(
          ({ end, normalizedTerm, start }) => {
            const matchedCandidates = candidatesByTerm.get(normalizedTerm);
            if (!matchedCandidates) {
              throw new Error("Text match candidate group is unavailable");
            }
            return {
              end,
              start,
              trademarks: matchedCandidates.map(candidateMark),
            };
          }
        ),
        text,
      });
    }

    return {
      meta: snapshot,
      texts,
    };
  });
}

function readCandidates(
  transaction: postgres.TransactionSql,
  terms: string[],
  type: MatchTextsInput["type"]
) {
  if (terms.length === 0) {
    return Promise.resolve([]);
  }
  const typePredicate = type === "all" ? "" : `and ${markTypeSql} = $2`;
  const values = type === "all" ? [JSON.stringify(terms)] : [JSON.stringify(terms), type];
  return transaction.unsafe<Candidate[]>(
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
}

function candidateMark(candidate: Candidate) {
  const { normalizedTerm: _normalizedTerm, ...mark } = candidate;
  return mark;
}
