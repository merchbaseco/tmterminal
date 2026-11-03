import { afterAll, beforeAll, expect, test } from "bun:test";
import postgres from "postgres";
import {
  matchTextsInputSchema,
  screenQueriesInputSchema,
  screenTextInputSchema,
} from "../../src/api/marks-input.ts";
import { summarizeScreenedText } from "../../src/api/screen-text.ts";
import { searchInputSchema } from "../../src/api/search-input.ts";
import { foldedMatchKeySql, matchKeySql } from "../../src/db/match-keys.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { candidateTextTerms } from "../../src/search/text-matching.ts";
import { createMarksService } from "../../src/services/marks-service.ts";
import parity from "../fixtures/factory-singular-parity.json";
import { resetTestDatabase } from "./test-database.ts";
import { createTestMarkRepository } from "./test-mark-repository.ts";

// The fixture is Factory's tm_forms.py run over the phrases, titles, tags, searches, and word
// marks of its tm_phrase_check and seo_tm_split_check cases, plus its rule edges. Regenerate it
// from Factory when tm_forms.py changes; `source` names the commit it came from.

const databaseUrl = process.env.TMTERMINAL_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 2, prepare: false });
const marks = createMarksService(database);

beforeAll(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  const repository = createTestMarkRepository(database);
  for (const [serialNumber, wordMark] of [
    ["12000001", "KITTEN NUGGET"],
    ["12000002", "MILK AND COOKIE"],
    ["12000003", "KITTEN NUGGETS BAKERY"],
    ["12000004", "PUPPY"],
  ] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: The repository writes one mark per call.
    await repository.replace({
      classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2026-07-10" }],
      contributors: [],
      goodsServices: [{ text: "shirts", typeCode: "GS0251" }],
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
      },
      owners: [],
      statusEvents: [],
      versions: {
        authorityPolicy: "uspto-authority-v1",
        normalization: "uspto-normalization-v1",
        projection: "uspto-projection-v2",
        sourceProfile: "uspto-application-xml-v2.0-v1",
      },
    });
  }
});

afterAll(async () => {
  await database.end();
});

async function singularKeys(texts: string[]) {
  const rows = await database.unsafe<Array<{ key: string }>>(
    `select ${matchKeySql(foldedMatchKeySql("source.text"), true)} as key
    from jsonb_array_elements_text($1::text::jsonb) with ordinality as source(text, position)
    order by source.position`,
    [JSON.stringify(texts)]
  );
  return rows.map(({ key }) => key);
}

test("singular keys equal Factory's numberless keys word for word", async () => {
  const keys = await singularKeys(parity.words.map(({ word }) => word));

  expect(parity.words.map(({ word }, index) => [word, keys[index]])).toEqual(
    parity.words.map(({ key, word }) => [word, key])
  );
});

test("singular keys equal Factory's numberless keys on every phrase its checks use", async () => {
  const keys = await singularKeys(parity.texts.map(({ text }) => text));

  expect(parity.texts.map(({ text }, index) => [text, keys[index]])).toEqual(
    parity.texts.map(({ key, text }) => [text, key])
  );
});

test("a singular screen covers every singular form Factory requires searched", async () => {
  const uncovered: string[] = [];
  for (const { singularForms, text } of parity.texts) {
    // biome-ignore lint/performance/noAwaitInLoops: Each phrase's span keys are one small query.
    const spanKeys = new Set(await singularKeys(candidateTextTerms(text)));
    for (const form of singularForms) {
      // biome-ignore lint/performance/noAwaitInLoops: Each form's alternatives are one small query.
      const formKeys = await singularKeys(form);
      if (!formKeys.some((key) => spanKeys.has(key))) {
        uncovered.push(`${text}: ${form.join(" or ")}`);
      }
    }
  }

  expect(parity.texts.filter(({ singularForms }) => singularForms.length > 0).length).toBe(21);
  expect(uncovered).toEqual([]);
});

function serialNumbers(trademarks: Array<{ serialNumber: string }>) {
  return trademarks.map(({ serialNumber }) => serialNumber);
}

test("screens match plural spans against singular marks unless singular is false", async () => {
  const text = "Kitten Nuggets, Milk and Cookies, puppies";
  const spans = async (input: Record<string, unknown>) => {
    const result = await marks.match(
      matchTextsInputSchema.parse({ texts: [{ id: "title", text }], ...input })
    );
    return result.texts.flatMap(({ matches }) =>
      matches.flatMap((match) =>
        serialNumbers(match.trademarks).map((serialNumber) => [
          serialNumber,
          text.slice(match.start, match.end),
        ])
      )
    );
  };
  const screened = async (input: Record<string, unknown>) => {
    const { singular, text: screenedText, type } = screenTextInputSchema.parse(input);
    const result = await marks.match({
      singular,
      texts: [{ id: "text", text: screenedText }],
      type,
    });
    return serialNumbers(summarizeScreenedText(result).trademarks);
  };

  expect(await spans({})).toEqual([
    ["12000001", "Kitten Nuggets"],
    ["12000002", "Milk and Cookies"],
    ["12000004", "puppies"],
  ]);
  expect(await spans({ singular: false })).toEqual([]);
  expect(await screened({ text: "kitten nugget" })).toEqual(["12000001"]);
  expect(await screened({ singular: false, text: "Kitten Nuggets" })).toEqual([]);
});

test("singular bulk screening counts equal their singular Multi drill-down", async () => {
  const queries = [
    { id: "plural", query: "Kitten Nuggets" },
    { id: "ies", query: "cookies" },
    { id: "literal", query: "nuggets bakery" },
  ];
  const counts = async (singular: boolean) => {
    const result = await marks.screen(screenQueriesInputSchema.parse({ queries, singular }));
    return result.queries.map(({ liveMatches }) => liveMatches);
  };
  const drillDowns = (singular: boolean) =>
    Promise.all(
      queries.map(async ({ query }) => {
        const page = await marks.search(
          searchInputSchema.parse({ mode: "multi", query, singular, status: "live" })
        );
        return page.liveMatchCounts;
      })
    );

  expect(await counts(true)).toEqual([
    { exact: 1, partial: 1 },
    { exact: 0, partial: 1 },
    { exact: 0, partial: 1 },
  ]);
  expect(await counts(false)).toEqual([
    { exact: 0, partial: 1 },
    { exact: 0, partial: 0 },
    { exact: 0, partial: 1 },
  ]);
  expect(await drillDowns(true)).toEqual(await counts(true));
  expect(await drillDowns(false)).toEqual(await counts(false));
  expect(screenQueriesInputSchema.parse({ queries }).singular).toBe(true);
  expect(searchInputSchema.parse({ mode: "multi", query: "cats" }).singular).toBe(false);
});

test("singular Split matches singular marks and Wildcard rejects singular", async () => {
  const split = await marks.search(
    searchInputSchema.parse({ mode: "split", query: "kitten nuggets forever", singular: true })
  );

  expect(serialNumbers(split.items)).toEqual(["12000001"]);
  expect(
    searchInputSchema.safeParse({ mode: "wildcard", query: "kitten*", singular: true }).success
  ).toBe(false);
});
