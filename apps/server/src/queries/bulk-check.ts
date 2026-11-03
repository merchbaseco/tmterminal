import type postgres from "postgres";

import type { BulkCheckInput, BulkCheckResult } from "../api/contracts.ts";
import { foldedMatchKeySql, matchKeySql } from "../db/match-keys.ts";
import { readDataSnapshot } from "./data-snapshot.ts";
import { markTypeSql } from "./mark-page.ts";

interface BulkCheckRow {
  id: string;
  liveExact: number;
  livePartial: number;
  query: string;
}

export function bulkCheck(database: postgres.Sql, input: BulkCheckInput): Promise<BulkCheckResult> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const snapshot = await readDataSnapshot(transaction);
    const query = buildBulkCheckQuery(input);
    const rows = await transaction.unsafe<BulkCheckRow[]>(query.text, query.values);

    return {
      meta: snapshot,
      queries: rows.map((row) => ({
        id: row.id,
        liveMatches: {
          exact: row.liveExact,
          partial: row.livePartial,
        },
        query: row.query,
      })),
    };
  });
}

// A singular Bulk Check keeps every literal match: a mark containing the folded query, or whose
// singular key contains the query's.
export function buildBulkCheckQuery(input: BulkCheckInput) {
  const typePredicate = input.type === "all" ? "" : `and ${markTypeSql} = $2`;
  const values =
    input.type === "all"
      ? [JSON.stringify(input.queries)]
      : [JSON.stringify(input.queries), input.type];
  const markKey = matchKeySql("m.word_mark_folded", input.singular);
  const contains = (column: string, value: string) =>
    `${column} like '%' || ${likeLiteralSql(value)} || '%' escape E'\\\\'`;
  const containsKey = input.singular ? ` or ${contains(markKey, "q.query_key")}` : "";
  return {
    text: `with input_queries as (
      select id, query, ordinality, folded_query,
        ${matchKeySql("folded_query", input.singular)} as query_key
      from (
        select source.value ->> 'id' as id, source.value ->> 'query' as query,
          source.ordinality,
          ${foldedMatchKeySql("source.value ->> 'query'")} as folded_query
        from jsonb_array_elements($1::text::jsonb) with ordinality
          as source(value, ordinality)
      ) folded_queries
    )
    select q.id, q.query,
      count(m.serial_number) filter (
        where ${markKey} = q.query_key
      )::int as "liveExact",
      count(m.serial_number) filter (
        where ${markKey} <> q.query_key
      )::int as "livePartial"
    from input_queries q
    left join mark m on m.search_status = 'live' and q.folded_query <> ''
      and (${contains("m.word_mark_folded", "q.folded_query")}${containsKey})
      ${typePredicate}
    group by q.id, q.query, q.ordinality
    order by q.ordinality`,
    values,
  };
}

function likeLiteralSql(value: string) {
  return `replace(
    replace(replace(${value}, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'),
    '_',
    chr(92) || '_'
  )`;
}
