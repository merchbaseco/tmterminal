import type postgres from "postgres";

import type { ReportInput, ReportPage } from "../api/contracts.ts";
import { DataVersionConflictError } from "./search.ts";

interface DataState {
  dataThroughDate: string | null;
  dataVersion: string;
}

type QueryValue = number | string;

export function previousWeekRange(today = new Date()) {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = from.getUTCDay() || 7;
  from.setUTCDate(from.getUTCDate() - day - 6);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function buildReportQueries(
  input: ReportInput,
  range: ReturnType<typeof previousWeekRange> | null
) {
  const values: QueryValue[] = [];
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
  const conditions: string[] = [];
  if (input.event === "filed" && range) {
    conditions.push(`m.filing_date between ${parameter(range.from)} and ${parameter(range.to)}`);
  } else if (input.event === "registered" && range) {
    conditions.push(
      `m.registration_date between ${parameter(range.from)} and ${parameter(range.to)}`
    );
  } else {
    conditions.push("m.status_code = '686'");
  }
  if (input.status !== "all") {
    conditions.push(`m.search_status = ${parameter(input.status)}`);
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
  const direction = input.sort === "oldest-activity" ? "asc" : "desc";
  const limitParameter = `$${values.length + 1}`;
  const offsetParameter = `$${values.length + 2}`;

  return {
    count: {
      text: `select count(*)::int as total
        from mark m where ${predicate}`,
      values,
    },
    items: {
      text: `select
          m.serial_number as "serialNumber",
          m.registration_number as "registrationNumber",
          m.word_mark as "wordMark",
          m.search_status as status,
          m.status_date::text as "statusDate",
          m.source_transaction_date::text as "sourceTransactionDate",
          ${markType} as type,
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
            where goods.serial_number = m.serial_number
            order by case
              when goods.type_code like 'GS025%' then 0
              when goods.type_code like 'GS%' then 1
              when goods.type_code like 'CC%' then 3
              else 2
            end, goods.ordinal
            limit 1) as "goodsServicesExcerpt"
        from mark m where ${predicate}
        order by m.source_transaction_date ${direction} nulls last, m.serial_number
        limit ${limitParameter} offset ${offsetParameter}`,
      values: [...values, input.limit, input.offset],
    },
  };
}

export function runReport(
  database: postgres.Sql,
  input: ReportInput,
  today = new Date()
): Promise<ReportPage> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const [state] = await transaction<DataState[]>`
      select state.complete_through_date::text as "dataThroughDate",
        coalesce(state.version, 0)::text as "dataVersion"
      from (select 1) anchor left join data_state state on state.id = 'uspto'
    `;
    if (!state) {
      throw new Error("Trademark data state is unavailable");
    }
    if (input.expectedDataVersion && input.expectedDataVersion !== state.dataVersion) {
      throw new DataVersionConflictError("Trademark data changed during pagination");
    }

    const range = input.event === "published-for-opposition" ? null : previousWeekRange(today);
    if (
      range &&
      input.expectedDataVersion &&
      (input.expectedFrom !== range.from || input.expectedTo !== range.to)
    ) {
      throw new DataVersionConflictError("Report window changed during pagination");
    }
    const queries = buildReportQueries(input, range);
    const [count] = await transaction.unsafe<Array<{ total: number }>>(
      queries.count.text,
      queries.count.values
    );
    if (!count) {
      throw new Error("Report count query returned no row");
    }
    const items = await transaction.unsafe<ReportPage["items"]>(
      queries.items.text,
      queries.items.values
    );
    return {
      from: range?.from ?? null,
      items,
      limit: input.limit,
      meta: { dataThroughDate: state.dataThroughDate, dataVersion: state.dataVersion },
      offset: input.offset,
      to: range?.to ?? null,
      total: count.total,
    };
  });
}
