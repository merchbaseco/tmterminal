import type postgres from "postgres";

import type { SearchInput, SearchPage } from "../api/contracts.ts";
import { splitSearchTerms } from "../search/search-patterns.ts";

interface DataState {
  completeThroughDate: string | null;
  dataVersion: string;
}

export class DataVersionConflictError extends Error {}

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
  const markType = `case
    when m.mark_drawing_code = '1' then 'typeset'
    when m.mark_drawing_code = '4' then 'text'
    when m.mark_drawing_code in ('2', '3', '5') then 'design'
    else 'other'
  end`;
  const conditions = [match.predicate];
  if (input.status === "live") {
    conditions.push("m.search_status = 'live'");
  }
  if (input.status === "dead") {
    conditions.push("m.search_status = 'dead'");
  }
  if (input.type !== "all") {
    conditions.push(`${markType} = ${parameter(input.type)}`);
  }
  if (input.registered === "yes") {
    conditions.push("m.registration_number is not null");
  }
  if (input.registered === "no") {
    conditions.push("m.registration_number is null");
  }
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
        select count(*)::int as total
        from mark m ${match.join} where ${predicate}`,
      values,
    },
    items: {
      text: `with ${match.normalized}
        select
          m.serial_number as "serialNumber",
          m.registration_number as "registrationNumber",
          m.word_mark as "wordMark",
          m.search_status as status,
          m.status_date::text as "statusDate",
          m.source_transaction_date::text as "sourceTransactionDate",
          ${markType} as type,
          ${match.kind} as match,
          array(
            select distinct classification.international_code
            from mark_class classification
            where classification.serial_number = m.serial_number
              and classification.international_code is not null
            order by classification.international_code
          ) as "internationalClasses",
          (select owner.party_name from mark_owner owner
            where owner.serial_number = m.serial_number order by owner.ordinal limit 1) as owner,
          (select goods.text from mark_goods_services goods
            where goods.serial_number = m.serial_number order by goods.ordinal limit 1) as "goodsServicesExcerpt"
        from mark m ${match.join} where ${predicate}
        order by ${orderBy}
        limit ${limitParameter} offset ${offsetParameter}`,
      values: itemValues,
    },
  };
}

export function searchMarks(database: postgres.Sql, input: SearchInput): Promise<SearchPage> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const [state] = await transaction<DataState[]>`
      select state.complete_through_date::text as "completeThroughDate",
        coalesce(state.version, 0)::text as "dataVersion"
      from (select 1) anchor left join data_state state on state.id = 'uspto'
    `;
    if (!state) {
      throw new Error("Trademark data state is unavailable");
    }
    if (input.expectedDataVersion && input.expectedDataVersion !== state.dataVersion) {
      throw new DataVersionConflictError("Trademark data changed during pagination");
    }

    const queries = buildSearchQueries(input);
    const [count] = await transaction.unsafe<Array<{ total: number }>>(
      queries.count.text,
      queries.count.values
    );
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
      meta: {
        dataThroughDate: state.completeThroughDate,
        dataVersion: state.dataVersion,
      },
      offset: input.offset,
      total: count.total,
    };
  });
}
