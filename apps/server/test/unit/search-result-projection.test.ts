import { expect, test } from "bun:test";

import type { MultiSearchInput, ReportInput } from "../../src/api/contracts.ts";
import { buildMultiSearchQueries } from "../../src/queries/multi-search.ts";
import { buildReportQueries } from "../../src/queries/reports.ts";

const class025Priority = "when goods.type_code like 'GS025%' then 0";
const goodsStatementPriority = "when goods.type_code like 'GS%' then 1";
const colorClaimPriority = "when goods.type_code like 'CC%' then 3";

test("search count exposes live exact and partial decision signals", () => {
  const input = {
    limit: 25,
    match: "both",
    mode: "multi",
    offset: 0,
    query: "good vibes",
    registered: "all",
    sort: "relevance",
    status: "all",
    type: "all",
  } satisfies MultiSearchInput;

  const queries = buildMultiSearchQueries(input);

  expect(queries.count.text).toContain('as "liveExact"');
  expect(queries.count.text).toContain('as "livePartial"');
});

test("search and report excerpts prefer Class 025 goods and demote color claims", () => {
  const search = buildMultiSearchQueries({
    limit: 25,
    match: "both",
    mode: "multi",
    offset: 0,
    query: "good vibes",
    registered: "all",
    sort: "relevance",
    status: "all",
    type: "all",
  });
  const report = buildReportQueries(
    {
      event: "filed",
      limit: 25,
      offset: 0,
      registered: "all",
      sort: "newest-activity",
      status: "all",
      type: "all",
      window: "previous-week",
    } satisfies ReportInput,
    { from: "2026-07-06", to: "2026-07-12" }
  );

  for (const query of [search.items.text, report.items.text]) {
    expect(query).toContain(class025Priority);
    expect(query).toContain(goodsStatementPriority);
    expect(query).toContain(colorClaimPriority);
  }
});
