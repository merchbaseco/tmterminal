import type postgres from "postgres";

import type { SearchInput, SearchPage } from "../api/contracts.ts";
import { foldedMatchKeySql, matchKeySql } from "../db/match-keys.ts";
import { splitSearchTerms } from "../search/search-patterns.ts";
import { assertDataVersion, readDataSnapshot } from "./data-snapshot.ts";
import { markFilterConditions, markSummarySql } from "./mark-page.ts";

type QueryValue = number | string;

function matchQuery(input: SearchInput) {
  const singular = input.mode !== "wildcard" && input.singular;
  if (input.mode === "split") {
    return {
      join: `join split_terms matched on ${matchKeySql("m.word_mark_folded", singular)} = matched.value`,
      kind: "'exact'",
      normalized: `split_terms as (
        select distinct on (value) value, rank from (
          select ${matchKeySql(foldedMatchKeySql("term"), singular)} as value,
            (ordinal - 1)::int as rank
          from jsonb_array_elements_text($1::text::jsonb) with ordinality as terms(term, ordinal)
        ) folded_terms where value <> '' order by value, rank
      )`,
      predicate: "true",
      relevanceOrder: "matched.rank, m.serial_number",
      values: [JSON.stringify(splitSearchTerms(input.query))] satisfies QueryValue[],
    };
  }

  // Multi compares punctuation-folded keys; Wildcard keeps punctuation literal around `*`.
  // Singular Multi compares singular keys and still keeps every literal partial match.
  const wildcard = input.mode === "wildcard";
  const column = wildcard ? "m.word_mark_normalized" : "m.word_mark_folded";
  const key = matchKeySql(column, singular);
  const value = wildcard
    ? `lower(normalize(btrim($1::text), NFKC) collate "und-x-icu") collate "default"`
    : foldedMatchKeySql("$1::text");
  const contains = (markValue: string, patternColumn: string) =>
    `${markValue} like '%' || normalized.${patternColumn} || '%' escape E'\\\\'`;
  const containsKey = singular ? ` or ${contains(key, "key_pattern")}` : "";
  const containsPredicate = `normalized.value <> '' and (${contains(column, "pattern")}${containsKey})`;
  let predicate = containsPredicate;
  if (wildcard) {
    predicate = input.query.normalize("NFKC").includes("*")
      ? `${column} like normalized.pattern escape E'\\\\'`
      : `${column} = normalized.value`;
  } else if (input.match === "exact") {
    predicate = `${key} = normalized.key`;
  } else if (input.match === "partial") {
    predicate = `${containsPredicate} and ${key} <> normalized.key`;
  }
  const escapedLiteral = (literal: string) => `replace(
    replace(replace(${literal}, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'),
    '_', chr(92) || '_'
  )`;
  const pattern = wildcard
    ? `replace(${escapedLiteral("value")}, '*', '%')`
    : escapedLiteral("value");

  return {
    join: "cross join normalized",
    kind: `case when ${key} = normalized.key then 'exact' else 'partial' end`,
    normalized: `query_value as (
        select value, ${matchKeySql("value", singular)} as key
        from (select ${value} as value) query_input
      ),
      normalized as (
        select value, key, ${pattern} as pattern, ${escapedLiteral("key")} as key_pattern
        from query_value
      )`,
    predicate,
    relevanceOrder: `case when ${key} = normalized.key then 0 else 1 end,
      similarity(${column}, normalized.value) desc,
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
