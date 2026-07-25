import type postgres from "postgres";

import type { ScreenQueriesInput, ScreenQueriesResult } from "../api/contracts.ts";
import { readDataSnapshot } from "./data-snapshot.ts";
import { markTypeSql } from "./mark-page.ts";

interface ScreenRow {
  id: string;
  liveExact: number;
  livePartial: number;
  query: string;
}

export function screenQueries(
  database: postgres.Sql,
  input: ScreenQueriesInput
): Promise<ScreenQueriesResult> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const snapshot = await readDataSnapshot(transaction);
    const typePredicate = input.type === "all" ? "" : `and ${markTypeSql} = $2`;
    const values =
      input.type === "all"
        ? [JSON.stringify(input.queries)]
        : [JSON.stringify(input.queries), input.type];
    const rows = await transaction.unsafe<ScreenRow[]>(
      `with input_queries as (
        select source.value ->> 'id' as id, source.value ->> 'query' as query,
          source.ordinality,
          lower(
            normalize(btrim(source.value ->> 'query'), NFKC) collate "und-x-icu"
          ) collate "default"
            as normalized_query
        from jsonb_array_elements($1::text::jsonb) with ordinality
          as source(value, ordinality)
      )
      select q.id, q.query,
        count(m.serial_number) filter (
          where m.word_mark_normalized = q.normalized_query
        )::int as "liveExact",
        count(m.serial_number) filter (
          where m.word_mark_normalized <> q.normalized_query
        )::int as "livePartial"
      from input_queries q
      left join mark m on m.search_status = 'live'
        and m.word_mark_normalized like
          '%' || replace(
            replace(
              replace(q.normalized_query, chr(92), chr(92) || chr(92)),
              '%',
              chr(92) || '%'
            ),
            '_',
            chr(92) || '_'
          ) || '%' escape E'\\\\'
        ${typePredicate}
      group by q.id, q.query, q.ordinality
      order by q.ordinality`,
      values
    );

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
