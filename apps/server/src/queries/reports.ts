import type postgres from "postgres";

import type { ReportInput, ReportPage } from "../api/contracts.ts";
import { assertDataVersion, DataVersionConflictError, readDataSnapshot } from "./data-snapshot.ts";
import { markFilterConditions, markSummarySql, markTypeSql } from "./mark-page.ts";

type QueryValue = number | string;
type OverviewBucket = ReportPage["overview"]["buckets"][number];
const reportTypes = ["design", "typeset", "text", "other"] as const;

function reportOverviewExpression(event: ReportInput["event"]) {
  if (event === "filed") {
    return "m.filing_date";
  }
  if (event === "registered") {
    return "m.registration_date";
  }
  return markTypeSql;
}

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
  conditions.push(...markFilterConditions(input, parameter));
  const predicate = conditions.join(" and ");
  const direction = input.sort === "oldest-activity" ? "asc" : "desc";
  const limitParameter = `$${values.length + 1}`;
  const offsetParameter = `$${values.length + 2}`;
  const overviewExpression = reportOverviewExpression(input.event);

  return {
    count: {
      text: `select count(*)::int as total
        from mark m where ${predicate}`,
      values,
    },
    items: {
      text: `select
          ${markSummarySql}
        from mark m where ${predicate}
        order by m.source_transaction_date ${direction} nulls last, m.serial_number
        limit ${limitParameter} offset ${offsetParameter}`,
      values: [...values, input.limit, input.offset],
    },
    overview: {
      text: `select (${overviewExpression})::text as key,
          count(*)::int as count,
          count(*) filter (where m.search_status = 'dead')::int as dead,
          count(*) filter (where m.search_status = 'live')::int as live
        from mark m where ${predicate}
        group by ${overviewExpression}
        order by ${overviewExpression}`,
      values,
    },
  };
}

export function runReport(
  database: postgres.Sql,
  input: ReportInput,
  today = new Date()
): Promise<ReportPage> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const snapshot = await readDataSnapshot(transaction);
    assertDataVersion(snapshot, input.expectedDataVersion);

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
    const overviewBuckets = await transaction.unsafe<OverviewBucket[]>(
      queries.overview.text,
      queries.overview.values
    );
    const items = await transaction.unsafe<ReportPage["items"]>(
      queries.items.text,
      queries.items.values
    );
    return {
      from: range?.from ?? null,
      items,
      limit: input.limit,
      meta: snapshot,
      offset: input.offset,
      overview: resolveOverview(input.event, range, overviewBuckets),
      to: range?.to ?? null,
      total: count.total,
    };
  });
}

function resolveOverview(
  event: ReportInput["event"],
  range: ReturnType<typeof previousWeekRange> | null,
  buckets: OverviewBucket[]
): ReportPage["overview"] {
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  if (range && event !== "published-for-opposition") {
    return {
      buckets: dateKeys(range).map((key) => byKey.get(key) ?? { count: 0, dead: 0, key, live: 0 }),
      dimension: "date",
    };
  }
  return {
    buckets: reportTypes.map((key) => byKey.get(key) ?? { count: 0, dead: 0, key, live: 0 }),
    dimension: "type",
  };
}

function dateKeys(range: ReturnType<typeof previousWeekRange>) {
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  const keys: string[] = [];
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
