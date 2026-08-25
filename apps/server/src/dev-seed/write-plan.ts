import type postgres from "postgres";

import { seedClearOrder } from "./table-columns.ts";
import type { DevSeedPlan, SeedTableWrite } from "./types.ts";

/**
 * Writes a plan into a local database. Idempotent by construction: every table
 * the seed owns is cleared and refilled inside one transaction, so a re-run
 * replaces last run's week instead of stacking a second one on top of it, and
 * a failure leaves the previous dataset intact.
 */

export async function writeDevSeedPlan(database: postgres.Sql, plan: DevSeedPlan) {
  await database.begin(async (transaction) => {
    await clearSeededData(transaction, plan.merchbaseUserId);

    for (const table of plan.tables) {
      // biome-ignore lint/performance/noAwaitInLoops: Tables insert in foreign-key order, so each write waits for its parent.
      await insertTableRows(transaction, table);
    }

    await grantOperatorRole(transaction);
  });
}

async function clearSeededData(
  transaction: postgres.TransactionSql,
  merchbaseUserId: string
): Promise<void> {
  for (const table of seedClearOrder) {
    // biome-ignore lint/performance/noAwaitInLoops: The clear is ordered so every child table empties before its parent.
    await transaction.unsafe(`delete from ${table}`);
  }

  // Role assignments hold a plain foreign key to `account`, so the seed
  // account's roles go first or the delete below is refused.
  await transaction`
    delete from role_assignment
    where account_id in (select id from account where merchbase_user_id = ${merchbaseUserId})
  `;
  await transaction`delete from account where merchbase_user_id = ${merchbaseUserId}`;
}

async function insertTableRows(
  transaction: postgres.TransactionSql,
  table: SeedTableWrite
): Promise<void> {
  if (table.rows.length === 0) {
    return;
  }

  const names = Object.keys(table.columns);
  const declaration = names
    .map((name) => `${name} ${table.columns[name as keyof typeof table.columns]}`)
    .join(", ");
  const selection = names.map((name) => `payload.${name}`).join(", ");

  // `$1::text::jsonb`, not `$1::jsonb`: a bare jsonb cast makes postgres.js
  // infer a jsonb parameter and encode the already-serialised string a second
  // time, which arrives as a JSON string rather than an array. The query
  // modules in `src/queries` take the same route for the same reason.
  await transaction.unsafe(
    `insert into ${table.table} (${names.join(", ")})
     select ${selection}
     from jsonb_to_recordset($1::text::jsonb) as payload(${declaration})`,
    [JSON.stringify(table.rows)]
  );
}

/**
 * Every account in a seeded database is an operator, so the Source Status
 * operator surface renders for whoever signs in locally. The seed cannot know
 * the Merchbase user id a developer's Clerk session resolves to, and the
 * loopback guard is what keeps this grant off any shared database.
 */
function grantOperatorRole(transaction: postgres.TransactionSql) {
  return transaction`
    insert into role_assignment (account_id, role)
    select id, 'operator' from account
    on conflict (account_id, role) do nothing
  `;
}
