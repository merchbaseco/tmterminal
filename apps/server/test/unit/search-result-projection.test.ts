import { expect, test } from "bun:test";

import type { SearchInput } from "../../src/api/contracts.ts";
import { buildSearchQueries } from "../../src/queries/search.ts";

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
  } satisfies SearchInput;

  const queries = buildSearchQueries(input);

  expect(queries.count.text).toContain('as "liveExact"');
  expect(queries.count.text).toContain('as "livePartial"');
});

test("search excerpts prefer Class 025 goods and demote color claims", () => {
  const search = buildSearchQueries({
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
  expect(search.items.text).toContain(class025Priority);
  expect(search.items.text).toContain(goodsStatementPriority);
  expect(search.items.text).toContain(colorClaimPriority);
});
