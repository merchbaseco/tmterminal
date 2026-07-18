import { afterAll, beforeAll, expect, test } from "bun:test";
import postgres from "postgres";
import { searchInputSchema } from "../../src/api/search-input.ts";
import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import type { ProjectedMark } from "../../src/ingestion/mark-types.ts";
import { runReport } from "../../src/queries/reports.ts";
import { buildSearchQueries } from "../../src/queries/search.ts";
import { resetTestDatabase } from "./test-database.ts";
import { createTestMarkRepository } from "./test-mark-repository.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 2, prepare: false });
let server: Awaited<ReturnType<typeof buildServer>>;

function previousWeek(today = new Date()) {
  const current = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - day - 6);
  const from = current.toISOString().slice(0, 10);
  current.setUTCDate(current.getUTCDate() + 6);
  return { from, to: current.toISOString().slice(0, 10) };
}

function mark(
  serialNumber: string,
  wordMark: string,
  options: Partial<ProjectedMark["mark"]> = {}
): ProjectedMark {
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
    versions: {
      authorityPolicy: "uspto-authority-v1",
      normalization: "uspto-normalization-v1",
      projection: "uspto-projection-v1",
      sourceProfile: "uspto-application-xml-v2.0-v1",
    },
  };
}

beforeAll(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  const repository = createTestMarkRepository(database);
  const reportWindow = previousWeek();
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
  await repository.replace(mark("11000001", "Naïve 東京 Club"));
  await repository.replace(mark("11000002", "Naïve 東京"));
  await repository.replace(mark("11000003", "東京 Club"));
  await repository.replace(mark("11000004", "Naïve"));
  await repository.replace(mark("11000005", "東京"));
  await repository.replace(mark("11000006", "Club"));
  await repository.replace(mark("11000007", "Naïve Club"));
  await repository.replace(mark("11000008", "Naïve"));
  await repository.replace(mark("11000009", "PUNCTALPHA PUNCTBETA"));
  await repository.replace(mark("11000010", "PUNCTALPHA"));
  await repository.replace(mark("11000011", "PUNCTBETA"));
  await repository.replace({
    ...mark("50000001", "FILED REPORT MARK", {
      filingDate: reportWindow.from,
    }),
    goodsServices: [
      { text: "Color is not claimed as a feature of the mark.", typeCode: "CC0000" },
      { text: "shirts and sweatshirts", typeCode: "GS0251" },
    ],
  });
  await repository.replace(
    mark("50000002", "REGISTERED REPORT MARK", {
      registrationDate: reportWindow.to,
      registrationNumber: "4000002",
    })
  );
  await repository.replace(
    mark("50000003", "OPPOSITION REPORT MARK", {
      statusCode: "686",
    })
  );
  await repository.replace(
    mark("50000004", "FILTERED FILED REPORT MARK", {
      filingDate: reportWindow.to,
      markDrawingCode: "2",
      registrationNumber: "5000004",
      sourceTransactionDate: "2026-07-08",
      statusCode: "626",
    })
  );
  await database`
    insert into mark ${database(
      Array.from({ length: 26 }, (_, index) => ({
        filing_date: reportWindow.from,
        mark_drawing_code: "4",
        normalization_version: "uspto-normalization-v1",
        serial_number: String(51_000_001 + index),
        source_filename: "test.zip",
        source_physical_record_index: index + 1,
        source_product: "TRTYRAP",
        source_sha256: "a".repeat(64),
        source_transaction_date: "2026-07-09",
        status_code: "616",
        word_mark: `REPORT PAGE ${index + 1}`,
      }))
    )}
  `;
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
        mark_drawing_code: "4",
        normalization_version: "uspto-normalization-v1",
        registration_number: String(2_000_001 + index),
        serial_number: String(20_000_001 + index),
        source_filename: "test.zip",
        source_physical_record_index: index + 1,
        source_product: "TRTYRAP",
        source_sha256: "a".repeat(64),
        source_transaction_date: "2026-07-10",
        status_code: "616",
        word_mark: `PAGINATION ${String(index + 1).padStart(2, "0")}`,
      }))
    )}
  `;
  await database`
    insert into mark_class (serial_number, ordinal, international_code, status_code, status_date,
      source_product, source_filename, source_sha256, source_physical_record_index)
    select serial_number, 1, '025', '6', '2026-07-10',
      source_product, source_filename, source_sha256, source_physical_record_index
    from mark where word_mark like 'PAGINATION %'
  `;
  await database`
    insert into mark ${database(
      Array.from({ length: 27 }, (_, index) => ({
        mark_drawing_code: "4",
        normalization_version: "uspto-normalization-v1",
        registration_number: String(6_000_001 + index),
        serial_number: String(22_000_001 + index),
        source_filename: "test.zip",
        source_physical_record_index: index + 1,
        source_product: "TRTYRAP",
        source_sha256: "a".repeat(64),
        source_transaction_date: "2026-07-10",
        status_code: "616",
        word_mark: "SPLIT PAGE",
      }))
    )}
  `;
  await database`
    insert into mark_class (serial_number, ordinal, international_code, status_code, status_date,
      source_product, source_filename, source_sha256, source_physical_record_index)
    select serial_number, 1, '025', '6', '2026-07-10',
      source_product, source_filename, source_sha256, source_physical_record_index
    from mark where word_mark = 'SPLIT PAGE'
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
    update data_state
    set complete_through_date = '2026-07-10', version = 7
    where id = 'uspto'
  `;
  await database`
    insert into source_artifact (
      id, product, filename, download_url, expected_bytes, source_from_date, source_to_date, updated_at
    ) values
      ('81000000-0000-4000-8000-000000000001', 'TEST', 'source-part-01.zip',
        'https://example.test/01.zip', 1, '2026-01-01', '2026-01-01', '2026-07-18T03:00:00Z'),
      ('81000000-0000-4000-8000-000000000002', 'TEST', 'source-part-02.zip',
        'https://example.test/02.zip', 1, '2026-01-02', '2026-01-02', '2026-07-18T02:00:00Z'),
      ('81000000-0000-4000-8000-000000000003', 'TEST', 'source-part-03.zip',
        'https://example.test/03.zip', 1, '2026-01-03', '2026-01-03', '2026-07-18T01:00:00Z')
  `;
  server = await buildServer({
    databaseUrl,
    devClerkSignIn: { createToken: async () => "unused", userId: "user_prd65" },
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

function report(input: Record<string, unknown>) {
  return server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: `/api/trpc/reports.run?input=${encodeURIComponent(JSON.stringify(input))}`,
  });
}

function operatorArtifacts(input: Record<string, unknown>) {
  return server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: `/api/trpc/ops.sync.artifacts?input=${encodeURIComponent(JSON.stringify(input))}`,
  });
}

test("operator artifact pagination keeps immutable source order", async () => {
  const first = await operatorArtifacts({ limit: 2, offset: 0 });
  await database`
    update source_artifact set updated_at = '2026-07-18T04:00:00Z'
    where filename = 'source-part-01.zip'
  `;
  await database`
    insert into source_artifact (
      id, product, filename, download_url, expected_bytes, source_from_date, source_to_date
    ) values (
      '81000000-0000-4000-8000-000000000004', 'TEST', 'source-part-04.zip',
      'https://example.test/04.zip', 1, '2026-01-04', '2026-01-04'
    )
  `;
  const second = await operatorArtifacts({ limit: 2, offset: 2 });

  expect(first.statusCode).toBe(200);
  expect(first.json().result.data.items.map((item: { filename: string }) => item.filename)).toEqual(
    ["source-part-01.zip", "source-part-02.zip"]
  );
  expect(
    second.json().result.data.items.map((item: { filename: string }) => item.filename)
  ).toEqual(["source-part-03.zip", "source-part-04.zip"]);
});

test("report presets use milestone dates and the current opposition status", async () => {
  const window = previousWeek();
  const filed = await report({ event: "filed", window: "previous-week" });
  const registered = await report({ event: "registered", window: "previous-week" });
  const opposition = await report({ event: "published-for-opposition" });

  expect(filed.statusCode).toBe(200);
  expect(filed.json().result.data).toMatchObject({
    from: window.from,
    to: window.to,
    total: 28,
  });
  expect(filed.json().result.data.items[0]).toMatchObject({ serialNumber: "50000001" });
  expect(filed.json().result.data.items[0]?.goodsServicesExcerpt).toBe("shirts and sweatshirts");
  expect(registered.json().result.data).toMatchObject({
    items: [{ serialNumber: "50000002" }],
    total: 1,
  });
  expect(opposition.json().result.data).toMatchObject({
    from: null,
    items: [{ serialNumber: "50000003" }],
    to: null,
    total: 1,
  });
});

test("reports filter, count, paginate, and pin the data version", async () => {
  const preset = {
    event: "filed",
    registered: "no",
    status: "live",
    type: "text",
    window: "previous-week",
  };
  const first = await report(preset);
  const { from, to } = first.json().result.data;
  const missingVersion = await report({ ...preset, offset: 25 });
  const missingWindow = await report({ ...preset, expectedDataVersion: "7", offset: 25 });
  const second = await report({
    ...preset,
    expectedDataVersion: "7",
    expectedFrom: from,
    expectedTo: to,
    offset: 25,
  });
  const filtered = await report({
    event: "filed",
    registered: "yes",
    status: "dead",
    type: "design",
    window: "previous-week",
  });
  await database`update data_state set version = 8 where id = 'uspto'`;
  const conflict = await report({
    ...preset,
    expectedDataVersion: "7",
    expectedFrom: from,
    expectedTo: to,
    offset: 25,
  });
  await database`update data_state set version = 7 where id = 'uspto'`;

  expect(first.json().result.data).toMatchObject({ limit: 25, offset: 0, total: 27 });
  expect(first.json().result.data.items).toHaveLength(25);
  expect(missingVersion.statusCode).toBe(400);
  expect(missingWindow.statusCode).toBe(400);
  expect(second.json().result.data).toMatchObject({ offset: 25, total: 27 });
  expect(second.json().result.data.items).toHaveLength(2);
  expect(filtered.json().result.data).toMatchObject({
    items: [{ serialNumber: "50000004" }],
    total: 1,
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.data.code).toBe("CONFLICT");
});

test("pinned report pages reject a previous-week boundary change", async () => {
  await expect(
    runReport(
      database,
      {
        event: "filed",
        expectedDataVersion: "7",
        expectedFrom: "2026-06-29",
        expectedTo: "2026-07-05",
        limit: 25,
        offset: 0,
        registered: "all",
        sort: "newest-activity",
        status: "all",
        type: "all",
        window: "previous-week",
      },
      new Date("2026-07-13T00:00:00Z")
    )
  ).rejects.toThrow("Report window changed during pagination");
});

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
    liveMatchCounts: { exact: 1, partial: 0 },
    meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
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

test("Multi result excerpts prefer goods statements over source color claims", async () => {
  const response = await search({ match: "exact", mode: "multi", query: "FILED REPORT MARK" });

  expect(response.statusCode).toBe(200);
  expect(response.json().result.data.items[0]?.goodsServicesExcerpt).toBe("shirts and sweatshirts");
});

test("Multi lowercases compatibility characters after NFKC", async () => {
  const exact = await search({ match: "exact", mode: "multi", query: "a" });

  expect(exact.statusCode).toBe(200);
  expect(exact.json().result.data).toMatchObject({
    items: [{ match: "exact", serialNumber: "10000013", wordMark: "ᴬ" }],
    total: 1,
  });
});

test("Split searches every adjacent Unicode word-token combination in stable relevance order", async () => {
  const response = await search({ mode: "split", query: "  NAI\u0308VE—東京, club  " });

  expect(response.statusCode).toBe(200);
  expect(response.json().result.data).toMatchObject({
    items: [
      { match: "exact", serialNumber: "11000001" },
      { match: "exact", serialNumber: "11000002" },
      { match: "exact", serialNumber: "11000003" },
      { match: "exact", serialNumber: "11000004" },
      { match: "exact", serialNumber: "11000008" },
      { match: "exact", serialNumber: "11000005" },
      { match: "exact", serialNumber: "11000006" },
    ],
    meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
    total: 7,
  });
  expect(
    response.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).not.toContain("11000007");
});

test("Split rejects punctuation-only queries and Multi-only match selection", async () => {
  const punctuation = await search({ mode: "split", query: "—!?" });
  const match = await search({ match: "exact", mode: "split", query: "turtle club" });

  expect(punctuation.statusCode).toBe(400);
  expect(punctuation.json().error.data.code).toBe("BAD_REQUEST");
  expect(match.statusCode).toBe(400);
  expect(match.json().error.data.code).toBe("BAD_REQUEST");
});

test("Split treats retained word punctuation as token separators", async () => {
  const responses = await Promise.all(
    ["punctalpha.punctbeta", "punctalpha_punctbeta", "punctalpha'punctbeta"].map((query) =>
      search({ mode: "split", query })
    )
  );

  for (const response of responses) {
    expect(response.statusCode).toBe(200);
    expect(
      response.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
    ).toEqual(["11000009", "11000010", "11000011"]);
  }
});

test("Wildcard matches the whole normalized mark and treats SQL pattern characters literally", async () => {
  const whole = await search({ mode: "wildcard", query: "turtle" });
  const zeroOrMore = await search({ mode: "wildcard", query: "turtle*club" });
  const percent = await search({ mode: "wildcard", query: "*50% symbol" });
  const underscore = await search({ mode: "wildcard", query: "a_b symbol*" });
  const backslash = await search({ mode: "wildcard", query: "path\\mark*" });

  expect(
    whole.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000004"]);
  expect(
    zeroOrMore.json().result.data.items.map((item: { serialNumber: string }) => item.serialNumber)
  ).toEqual(["10000005"]);
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

test("Wildcard rejects unindexed degenerate patterns and Multi-only match selection", async () => {
  const onlyStars = await search({ mode: "wildcard", query: "***" });
  const shortRuns = await search({ mode: "wildcard", query: "*a*b*" });
  const sqlMetacharactersOnly = await search({ mode: "wildcard", query: "%_\\*" });
  const match = await search({ match: "partial", mode: "wildcard", query: "turtle*" });

  expect(onlyStars.statusCode).toBe(400);
  expect(onlyStars.json().error.data.code).toBe("BAD_REQUEST");
  expect(shortRuns.statusCode).toBe(400);
  expect(shortRuns.json().error.data.code).toBe("BAD_REQUEST");
  expect(sqlMetacharactersOnly.statusCode).toBe(400);
  expect(sqlMetacharactersOnly.json().error.data.code).toBe("BAD_REQUEST");
  expect(match.statusCode).toBe(400);
  expect(match.json().error.data.code).toBe("BAD_REQUEST");
});

test("Split and Wildcard preserve filters, count, and pinned 25-item pagination", async () => {
  const filters = { registered: "yes", status: "live", type: "text" };
  const pages = await Promise.all(
    [
      { mode: "split", query: "split page" },
      { mode: "wildcard", query: "split*" },
    ].map((input) =>
      Promise.all([
        search({ ...filters, ...input }),
        search({
          ...filters,
          ...input,
          expectedDataVersion: "7",
          offset: 25,
        }),
      ])
    )
  );

  for (const [first, second] of pages) {
    expect(first.statusCode).toBe(200);
    expect(first.json().result.data).toMatchObject({ limit: 25, offset: 0, total: 27 });
    expect(first.json().result.data.items).toHaveLength(25);
    expect(second.statusCode).toBe(200);
    expect(second.json().result.data).toMatchObject({ offset: 25, total: 27 });
    expect(second.json().result.data.items).toHaveLength(2);
  }
});

test("search modes never interpret exact identity fields as word-mark matches", async () => {
  const inputs = [
    { mode: "multi", query: "10000004" },
    { mode: "split", query: "10000004" },
    { mode: "wildcard", query: "10000004" },
    { mode: "multi", query: "3000001" },
    { mode: "split", query: "3000001" },
    { mode: "wildcard", query: "3000001" },
  ];

  const responses = await Promise.all(inputs.map((input) => search(input)));
  for (const response of responses) {
    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toMatchObject({ items: [], total: 0 });
  }
});

test("exact lookups return not found when an identity is absent", async () => {
  const absentSerial = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: `/api/trpc/marks.get?input=${encodeURIComponent(JSON.stringify({ serialNumber: "99999999" }))}`,
  });
  const absentRegistration = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: `/api/trpc/marks.get-by-registration?input=${encodeURIComponent(JSON.stringify({ registrationNumber: "9999999" }))}`,
  });
  expect(absentSerial.statusCode).toBe(404);
  expect(absentSerial.json().error.data.code).toBe("NOT_FOUND");
  expect(absentRegistration.statusCode).toBe(404);
  expect(absentRegistration.json().error.data.code).toBe("NOT_FOUND");
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

test("continuations are fixed at 25 items and reject a changed data version", async () => {
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
    expectedDataVersion: "7",
    mode: "multi",
    offset: 25,
    query: "pagination",
  });
  await database`update data_state set version = 8 where id = 'uspto'`;
  const conflict = await search({
    ...filters,
    expectedDataVersion: "7",
    mode: "multi",
    offset: 25,
    query: "pagination",
  });
  await database`update data_state set version = 7 where id = 'uspto'`;

  expect(first.json().result.data).toMatchObject({ limit: 25, offset: 0, total: 27 });
  expect(first.json().result.data.items).toHaveLength(25);
  expect(missingVersion.statusCode).toBe(400);
  expect(missingVersion.json().error.data.code).toBe("BAD_REQUEST");
  expect(second.json().result.data).toMatchObject({ offset: 25, total: 27 });
  expect(second.json().result.data.items).toHaveLength(2);
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error).toMatchObject({
    data: { code: "CONFLICT" },
    message: "Trademark data changed during pagination",
  });
});

test("status and type filters apply to live Class 025 data", async () => {
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

test("representative-scale search modes use exact and trigram indexes", async () => {
  await database`
    insert into mark (
      serial_number,
      word_mark,
      status_code,
      source_transaction_date,
      normalization_version, source_product, source_filename, source_sha256, source_physical_record_index
    )
    select
      '4' || lpad(value::text, 7, '0'),
      'PLAN NEEDLE ' || lpad(value::text, 6, '0'),
      case when value % 10 = 0 then '616' else '626' end,
      '2026-07-10',
      'uspto-normalization-v1', 'TRTYRAP', 'plan.zip', ${"b".repeat(64)}, value
    from generate_series(1, 100000) value
  `;
  await database.unsafe("vacuum analyze mark");

  async function indexPlan(input: unknown) {
    const query = buildSearchQueries(searchInputSchema.parse(input));
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
  const split = await indexPlan({
    mode: "split",
    query: "plan needle 042421",
  });
  const wildcard = await indexPlan({
    mode: "wildcard",
    query: "plan*042421",
  });

  expect(generalExact).toContain("mark_word_mark_exact_idx");
  expect(generalPartial).toContain("mark_word_mark_normalized_trgm_idx");
  expect(liveExact).toContain("mark_live_word_mark_exact_idx");
  expect(livePartial).toContain("mark_live_word_mark_normalized_trgm_idx");
  expect(split).toContain("mark_word_mark_exact_idx");
  expect(wildcard).toContain("mark_word_mark_normalized_trgm_idx");
}, 60_000);
