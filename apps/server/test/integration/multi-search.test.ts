import { afterAll, beforeAll, expect, test } from "bun:test";
import postgres from "postgres";
import { multiSearchInputSchema } from "../../src/api/multi-search-input.ts";
import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import {
  canonicalVersions,
  type ResolvedCanonicalMark,
} from "../../src/ingestion/canonical-mark-types.ts";
import { createCanonicalMarkRepository } from "../../src/queries/canonical-mark-repository.ts";
import { buildMultiSearchQueries } from "../../src/queries/multi-search.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 2, prepare: false });
let server: Awaited<ReturnType<typeof buildServer>>;

function mark(
  serialNumber: string,
  wordMark: string,
  options: Partial<ResolvedCanonicalMark["mark"]> = {}
): ResolvedCanonicalMark {
  return {
    classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2026-07-10" }],
    contributors: [],
    goodsServices: [{ text: "shirts and sweatshirts", typeCode: "GS0251" }],
    kind: "resolved",
    mark: {
      filingDate: "2026-01-01",
      markDrawingCode: "4",
      registrationDate: null,
      registrationNumber: null,
      serialNumber,
      sourceTransactionDate: "2026-07-10",
      statusCode: "616",
      statusDate: "2026-07-10",
      wordMark,
      ...options,
    },
    owners: [{ entryNumber: "1", partyName: "TURTLE GOODS LLC", partyType: "16" }],
    statusEvents: [],
    versions: canonicalVersions,
  };
}

beforeAll(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  const repository = createCanonicalMarkRepository(database);
  await repository.replace(mark("10000001", "Caf\u00e9 Society"));
  await repository.replace(mark("10000002", "Cafe\u0301"));
  await repository.replace(mark("10000003", "THE CAF\u00c9 SOCIETY CLUB", { statusCode: "626" }));
  await repository.replace(mark("10000004", "TURTLE", { sourceTransactionDate: "2026-07-09" }));
  await repository.replace(
    mark("10000005", "TURTLE CLUB", { sourceTransactionDate: "2026-07-11" })
  );
  await repository.replace(
    mark("10000006", "TURTLE SOCIETY", { sourceTransactionDate: "2026-07-11" })
  );
  await repository.replace(mark("10000007", "50% SYMBOL"));
  await repository.replace(mark("10000008", "50X SYMBOL"));
  await repository.replace(mark("10000009", "A_B SYMBOL"));
  await repository.replace(mark("10000010", "AXB SYMBOL"));
  await repository.replace(mark("10000011", "PATH\\MARK SYMBOL"));
  await repository.replace(mark("10000012", "PATHXMARK SYMBOL"));
  await repository.replace(mark("10000013", "ᴬ"));
  await repository.replace(
    mark("30000001", "POLICY ACTIVE 25", {
      markDrawingCode: "4",
      registrationNumber: "3000001",
      statusCode: "616",
    })
  );
  await repository.replace(
    mark("30000002", "POLICY DESIGN", { markDrawingCode: "2", statusCode: "616" })
  );
  await repository.replace({
    ...mark("30000003", "POLICY INACTIVE 25", { statusCode: "616" }),
    classes: [{ internationalCode: "025", statusCode: "8", statusDate: "2026-07-10" }],
  });
  await repository.replace({
    ...mark("30000004", "POLICY DEAD 25", { statusCode: "626" }),
    classes: [{ internationalCode: "025", statusCode: "8", statusDate: "2026-07-10" }],
  });
  await repository.replace(mark("30000005", "POLICY UNKNOWN 25", { statusCode: "000" }));
  await repository.replace({
    ...mark("30000006", "POLICY REPEATED 25", { statusCode: "616" }),
    classes: [
      { internationalCode: "025", statusCode: "6", statusDate: "2026-07-10" },
      { internationalCode: "025", statusCode: "6", statusDate: "2026-07-11" },
    ],
  });
  await repository.replace(mark("30000007", "POLICY INDIFFERENT 622", { statusCode: "622" }));
  await repository.replace(mark("30000008", "POLICY INDIFFERENT 715", { statusCode: "715" }));
  await repository.replace(mark("30000009", "POLICY INDIFFERENT 970", { statusCode: "970" }));
  await repository.replace(mark("30000010", "POLICY NULL STATUS", { statusCode: null }));
  await repository.replace(mark("30000011", "POLICY FUTURE STATUS", { statusCode: "999" }));
  await database`
    insert into mark ${database(
      Array.from({ length: 27 }, (_, index) => ({
        authority_policy_version: canonicalVersions.authorityPolicy,
        mark_drawing_code: "4",
        normalization_version: canonicalVersions.normalization,
        projection_version: canonicalVersions.projection,
        registration_number: String(2_000_001 + index),
        serial_number: String(20_000_001 + index),
        source_profile_version: canonicalVersions.sourceProfile,
        source_transaction_date: "2026-07-10",
        status_code: "616",
        word_mark: `PAGINATION ${String(index + 1).padStart(2, "0")}`,
      }))
    )}
  `;
  await database`
    insert into mark_class (serial_number, ordinal, international_code, status_code, status_date)
    select serial_number, 0, '025', '6', '2026-07-10'
    from mark where word_mark like 'PAGINATION %'
  `;
  await repository.replace(
    mark("20000028", "PAGINATION WRONG STATUS", {
      registrationNumber: "2000028",
      statusCode: "626",
    })
  );
  await repository.replace(
    mark("20000030", "PAGINATION WRONG TYPE", {
      markDrawingCode: "2",
      registrationNumber: "2000030",
    })
  );
  await repository.replace(mark("20000031", "PAGINATION UNREGISTERED"));
  await database`
    insert into corpus_state (id, complete_through_date, published_through_date, corpus_version)
    values ('uspto', '2026-07-10', '2026-07-10', 7)
  `;
  server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => (token === "clerk-session" ? "user_prd65" : null),
  });
}, 30_000);

afterAll(async () => {
  await server?.close();
  await database.end({ timeout: 1 });
});

function search(input: Record<string, unknown>, authorization = "Bearer clerk-session") {
  return server.inject({
    headers: { authorization },
    method: "GET",
    url: `/api/trpc/marks.search?input=${encodeURIComponent(JSON.stringify(input))}`,
  });
}

test("Multi returns the same page through Clerk and API-key credentials", async () => {
  const created = await server.inject({
    headers: { authorization: "Bearer clerk-session", "content-type": "application/json" },
    method: "POST",
    payload: { name: "PRD-65 parity" },
    url: "/api/trpc/account.api-keys.create",
  });
  const token = created.json().result.data.token as string;
  const input = { mode: "multi", query: "turtle", status: "live" };
  const clerk = await search(input);
  const apiKey = await search(input, `Bearer ${token}`);
  const anonymous = await search(input, "");

  expect(apiKey.statusCode).toBe(200);
  expect(apiKey.json().result.data).toEqual(clerk.json().result.data);
  expect(anonymous.statusCode).toBe(401);
  expect(anonymous.json().error.data.code).toBe("UNAUTHORIZED");
});

test("Multi normalizes one literal Unicode query and keeps exact and partial independent", async () => {
  const exact = await search({ match: "exact", mode: "multi", query: "  CAFE\u0301  " });
  const partial = await search({ match: "partial", mode: "multi", query: "  CAFE\u0301  " });
  const both = await search({ match: "both", mode: "multi", query: "  CAFE\u0301  " });

  expect(exact.statusCode).toBe(200);
  expect(exact.json().result.data).toMatchObject({
    items: [{ match: "exact", serialNumber: "10000002", wordMark: "Cafe\u0301" }],
    limit: 25,
    meta: { corpusThroughDate: "2026-07-10", corpusVersion: "7" },
    offset: 0,
    total: 1,
  });
  expect(
    partial.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000001", "10000003"]);
  expect(
    both
      .json()
      .result.data.items.map((item: { match: string; serialNumber: string }) => [
        item.serialNumber,
        item.match,
      ])
  ).toEqual([
    ["10000002", "exact"],
    ["10000001", "partial"],
    ["10000003", "partial"],
  ]);
});

test("Multi lowercases compatibility characters after NFKC", async () => {
  const exact = await search({ match: "exact", mode: "multi", query: "a" });

  expect(exact.statusCode).toBe(200);
  expect(exact.json().result.data).toMatchObject({
    items: [{ match: "exact", serialNumber: "10000013", wordMark: "ᴬ" }],
    total: 1,
  });
});

test("Multi partial treats percent, underscore, and the escape character literally", async () => {
  const percent = await search({ match: "partial", mode: "multi", query: "50%" });
  const underscore = await search({ match: "partial", mode: "multi", query: "A_B" });
  const backslash = await search({ match: "partial", mode: "multi", query: "PATH\\MARK" });

  expect(
    percent.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000007"]);
  expect(
    underscore.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000009"]);
  expect(
    backslash.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000011"]);
});

test("activity sorts use source transaction date and serial-number tie-breakers", async () => {
  const newest = await search({ mode: "multi", query: "turtle", sort: "newest-activity" });
  const oldest = await search({ mode: "multi", query: "turtle", sort: "oldest-activity" });

  expect(
    newest.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000005", "10000006", "10000004"]);
  expect(
    oldest.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000004", "10000005", "10000006"]);
});

test("continuations are fixed at 25 items and reject a changed corpus version", async () => {
  const filters = { registered: "yes", status: "live", type: "text" };
  const first = await search({ ...filters, mode: "multi", query: "pagination" });
  const missingVersion = await search({
    ...filters,
    mode: "multi",
    offset: 25,
    query: "pagination",
  });
  const second = await search({
    ...filters,
    expectedCorpusVersion: "7",
    mode: "multi",
    offset: 25,
    query: "pagination",
  });
  await database`update corpus_state set corpus_version = 8 where id = 'uspto'`;
  const conflict = await search({
    ...filters,
    expectedCorpusVersion: "7",
    mode: "multi",
    offset: 25,
    query: "pagination",
  });
  await database`update corpus_state set corpus_version = 7 where id = 'uspto'`;

  expect(first.json().result.data).toMatchObject({ limit: 25, offset: 0, total: 27 });
  expect(first.json().result.data.items).toHaveLength(25);
  expect(missingVersion.statusCode).toBe(400);
  expect(missingVersion.json().error.data.code).toBe("BAD_REQUEST");
  expect(second.json().result.data).toMatchObject({ offset: 25, total: 27 });
  expect(second.json().result.data.items).toHaveLength(2);
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error).toMatchObject({
    data: { code: "CONFLICT" },
    message: "Trademark corpus changed during pagination",
  });
});

test("status and type filters apply within the Class 025 corpus", async () => {
  const live = await search({
    mode: "multi",
    query: "policy",
    sort: "oldest-activity",
    status: "live",
  });
  const dead = await search({
    mode: "multi",
    query: "policy",
    sort: "oldest-activity",
    status: "dead",
  });
  const all = await search({
    mode: "multi",
    query: "policy",
    sort: "oldest-activity",
    status: "all",
  });
  const combined = await search({
    mode: "multi",
    query: "policy",
    registered: "no",
    sort: "oldest-activity",
    status: "live",
    type: "design",
  });

  expect(
    live
      .json()
      .result.data.items.map((item: { serialNumber: string; status: string }) => [
        item.serialNumber,
        item.status,
      ])
  ).toEqual([
    ["30000001", "live"],
    ["30000002", "live"],
    ["30000003", "live"],
    ["30000006", "live"],
  ]);
  expect(live.json().result.data.total).toBe(4);
  expect(
    dead.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["30000004"]);
  expect(
    all
      .json()
      .result.data.items.map((item: { serialNumber: string; status: string }) => [
        item.serialNumber,
        item.status,
      ])
  ).toEqual([
    ["30000001", "live"],
    ["30000002", "live"],
    ["30000003", "live"],
    ["30000004", "dead"],
    ["30000005", "unknown"],
    ["30000006", "live"],
    ["30000007", "unknown"],
    ["30000008", "unknown"],
    ["30000009", "unknown"],
    ["30000010", "unknown"],
    ["30000011", "unknown"],
  ]);
  expect(all.json().result.data.total).toBe(11);
  expect(
    combined.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["30000002"]);
});

test("rejects the retired class-filter input", async () => {
  const response = await search({ classes: ["025"], mode: "multi", query: "turtle" });

  expect(response.statusCode).toBe(400);
  expect(response.json().error.data.code).toBe("BAD_REQUEST");
});

test("representative-scale exact and partial plans use general and live indexes", async () => {
  await database`
    insert into mark (
      serial_number,
      word_mark,
      status_code,
      source_transaction_date,
      normalization_version,
      source_profile_version,
      projection_version,
      authority_policy_version
    )
    select
      '4' || lpad(value::text, 7, '0'),
      'PLAN NEEDLE ' || lpad(value::text, 6, '0'),
      case when value % 10 = 0 then '616' else '626' end,
      '2026-07-10',
      ${canonicalVersions.normalization},
      ${canonicalVersions.sourceProfile},
      ${canonicalVersions.projection},
      ${canonicalVersions.authorityPolicy}
    from generate_series(1, 100000) value
  `;
  await database.unsafe("vacuum analyze mark");

  async function indexPlan(input: unknown) {
    const query = buildMultiSearchQueries(multiSearchInputSchema.parse(input));
    const plan = await database.unsafe(
      `explain (format json) ${query.items.text}`,
      query.items.values
    );
    return JSON.stringify(plan);
  }

  const generalExact = await indexPlan({
    match: "exact",
    mode: "multi",
    query: "plan needle 042421",
  });
  const generalPartial = await indexPlan({
    match: "partial",
    mode: "multi",
    query: "needle 042421",
  });
  const liveExact = await indexPlan({
    match: "exact",
    mode: "multi",
    query: "plan needle 042400",
    status: "live",
  });
  const livePartial = await indexPlan({
    match: "partial",
    mode: "multi",
    query: "needle 042400",
    status: "live",
  });

  expect(generalExact).toContain("mark_word_mark_normalized_exact_idx");
  expect(generalPartial).toContain("mark_word_mark_normalized_trgm_idx");
  expect(liveExact).toContain("mark_live_word_mark_normalized_exact_idx");
  expect(livePartial).toContain("mark_live_word_mark_normalized_trgm_idx");
}, 60_000);
