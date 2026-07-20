import type postgres from "postgres";

import type { SearchInput, SearchPage } from "../api/contracts.ts";
import { splitSearchTerms } from "../search/search-patterns.ts";
import { assertDataVersion, readDataSnapshot } from "./data-snapshot.ts";
import { markFilterConditions, markSummarySql } from "./mark-page.ts";

type QueryValue = number | string;

function matchQuery(input: SearchInput) {
  if (input.mode === "split") {
    return {
      join: "join split_terms matched on m.word_mark_normalized = matched.value",
      kind: "'exact'",
      normalized: `split_terms as (
        select distinct on (value) value, rank from (
          select lower(normalize(term, NFKC) collate "und-x-icu") collate "default" as value,
            (ordinal - 1)::int as rank
          from jsonb_array_elements_text($1::text::jsonb) with ordinality as terms(term, ordinal)
        ) normalized_terms order by value, rank
      )`,
      predicate: "true",
      relevanceOrder: "matched.rank, m.serial_number",
      values: [JSON.stringify(splitSearchTerms(input.query))] satisfies QueryValue[],
    };
  }

  const containsPredicate =
    "m.word_mark_normalized like '%' || normalized.pattern || '%' escape E'\\\\'";
  const wildcard = input.mode === "wildcard";
  let predicate = containsPredicate;
  if (wildcard) {
    predicate = input.query.normalize("NFKC").includes("*")
      ? "m.word_mark_normalized like normalized.pattern escape E'\\\\'"
      : "m.word_mark_normalized = normalized.value";
  } else if (input.match === "exact") {
    predicate = "m.word_mark_normalized = normalized.value";
  } else if (input.match === "partial") {
    predicate = `${containsPredicate} and m.word_mark_normalized <> normalized.value`;
  }
  const escapedLiteral = `replace(
    replace(replace(value, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'),
    '_', chr(92) || '_'
  )`;
  const pattern = wildcard ? `replace(${escapedLiteral}, '*', '%')` : escapedLiteral;

  return {
    join: "cross join normalized",
    kind: "case when m.word_mark_normalized = normalized.value then 'exact' else 'partial' end",
    normalized: `query_value as (
      select lower(normalize(btrim($1::text), NFKC) collate "und-x-icu") collate "default" as value
    ), normalized as (select value, ${pattern} as pattern from query_value)`,
    predicate,
    relevanceOrder: `case when m.word_mark_normalized = normalized.value then 0 else 1 end,
      similarity(m.word_mark_normalized, normalized.value) desc,
      m.serial_number`,
    values: [input.query] satisfies QueryValue[],
  };
}

export function buildSearchQueries(input: SearchInput) {
  const match = matchQuery(input);
  const values: QueryValue[] = [...match.values];
  const parameter = (value: QueryValue) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = [match.predicate, ...markFilterConditions(input, parameter)];
  const predicate = conditions.join(" and ");
  let orderBy = match.relevanceOrder;
  if (input.sort === "newest-activity") {
    orderBy = "m.source_transaction_date desc nulls last, m.serial_number";
  } else if (input.sort === "oldest-activity") {
    orderBy = "m.source_transaction_date asc nulls last, m.serial_number";
  }
  const itemValues: QueryValue[] = [...values, input.limit, input.offset];
  const limitParameter = `$${values.length + 1}`;
  const offsetParameter = `$${values.length + 2}`;

  return {
    count: {
      text: `with ${match.normalized}
        select count(*)::int as total,
          count(*) filter (
            where m.search_status = 'live' and ${match.kind} = 'exact'
          )::int as "liveExact",
          count(*) filter (
            where m.search_status = 'live' and ${match.kind} = 'partial'
          )::int as "livePartial"
        from mark m ${match.join} where ${predicate}`,
      values,
    },
    items: {
      text: `with ${match.normalized}
        select
          ${markSummarySql},
          ${match.kind} as match
        from mark m ${match.join} where ${predicate}
        order by ${orderBy}
        limit ${limitParameter} offset ${offsetParameter}`,
      values: itemValues,
    },
  };
}

export function searchMarks(database: postgres.Sql, input: SearchInput): Promise<SearchPage> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const snapshot = await readDataSnapshot(transaction);
    assertDataVersion(snapshot, input.expectedDataVersion);

    const queries = buildSearchQueries(input);
    const [count] = await transaction.unsafe<
      Array<{ liveExact: number; livePartial: number; total: number }>
    >(queries.count.text, queries.count.values);
    if (!count) {
      throw new Error("Trademark search count query returned no row");
    }
    const items = await transaction.unsafe<SearchPage["items"]>(
      queries.items.text,
      queries.items.values
    );

    return {
      items,
      limit: input.limit,
      liveMatchCounts: { exact: count.liveExact, partial: count.livePartial },
      meta: snapshot,
      offset: input.offset,
      total: count.total,
    };
  });
}
