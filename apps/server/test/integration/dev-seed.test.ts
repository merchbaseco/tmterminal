import { afterAll, beforeAll, expect, test } from "bun:test";
import postgres from "postgres";
import { defaultSearchPreferences } from "../../src/account-preferences.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { buildDevSeedPlan, defaultSeedOptions } from "../../src/dev-seed/plan.ts";
import { writeDevSeedPlan } from "../../src/dev-seed/write-plan.ts";
import { resetTestDatabase } from "./test-database.ts";

/**
 * The seed's contract against a real database: a re-run refreshes the week
 * instead of stacking a second one on top of it, and it leaves a developer's
 * own account alone while making it an operator.
 */

const databaseUrl = process.env.TMTERMINAL_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 2, prepare: false });
const developerAccountId = "11111111-1111-4111-8111-111111111111";
const developerUserId = "mbu_local_developer";
const options = { ...defaultSeedOptions, markCount: 40, now: new Date() };

async function countRows() {
  const [counts] = await database<[Record<string, number>]>`
    select (select count(*) from mark)::int as mark,
      (select count(*) from mark_class)::int as "markClass",
      (select count(*) from mark_owner)::int as "markOwner",
      (select count(*) from mark_goods_services)::int as "markGoods",
      (select count(*) from mark_status_event)::int as "markEvent",
      (select count(*) from trademark_recency)::int as recency,
      (select count(*) from source_artifact)::int as artifact,
      (select count(*) from account)::int as account,
      (select count(*) from role_assignment)::int as role
  `;
  return counts;
}

beforeAll(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  await database`
    insert into account (id, merchbase_user_id, name, search_preferences)
    values (${developerAccountId}, ${developerUserId}, 'Local Developer',
      ${database.json(defaultSearchPreferences)})
  `;
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

test("a re-run refreshes the dataset instead of duplicating it", async () => {
  await writeDevSeedPlan(database, buildDevSeedPlan(options));
  const first = await countRows();

  expect(first.mark).toBe(options.markCount);
  expect(first.artifact).toBeGreaterThan(0);

  // A second run against a database the seed already filled is the case that
  // matters: every cloud boot re-seeds a cluster that survived the last one.
  await writeDevSeedPlan(database, buildDevSeedPlan({ ...options, now: new Date() }));

  expect(await countRows()).toEqual(first);
});

test("keeps a developer's own account and makes every account an operator", async () => {
  const accounts = await database<Array<{ merchbaseUserId: string; pageSize: number }>>`
    select merchbase_user_id as "merchbaseUserId",
      (search_preferences ->> 'pageSize')::int as "pageSize"
    from account order by merchbase_user_id
  `;

  expect(accounts.map((row) => row.merchbaseUserId)).toEqual([
    defaultSeedOptions.merchbaseUserId,
    developerUserId,
  ]);
  // The developer's saved preferences survived; only the seed's own account is
  // rewritten.
  expect(accounts.find((row) => row.merchbaseUserId === developerUserId)?.pageSize).toBe(
    defaultSearchPreferences.pageSize
  );

  const operators = await database<Array<{ merchbaseUserId: string }>>`
    select account.merchbase_user_id as "merchbaseUserId"
    from role_assignment
    join account on account.id = role_assignment.account_id
    where role_assignment.role = 'operator'
  `;
  expect(operators).toHaveLength(2);
});

test("leaves no artifact a running ingestion worker would reserve", async () => {
  // The seed must never become an outbound USPTO request. This is the same
  // promise the plan test makes, asserted against what actually landed.
  const [reservable] = await database<[{ count: number }]>`
    select count(*)::int as count from source_artifact
    where (processing_disposition = 'required' and download_state = 'pending')
      or (download_state = 'downloaded' and object_key is not null and sha256 is not null
        and application_state in ('pending', 'applying'))
      or download_state = 'downloading'
  `;

  expect(reservable?.count).toBe(0);
});

test("marks are readable through the generated search columns", async () => {
  const [summary] = await database<[{ live: number; normalized: number }]>`
    select count(*) filter (where search_status = 'live')::int as live,
      count(*) filter (where word_mark_normalized is not null)::int as normalized
    from mark
  `;

  expect(summary?.live).toBeGreaterThan(0);
  expect(summary?.normalized).toBe(options.markCount);
});
