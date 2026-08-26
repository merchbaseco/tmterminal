import type postgres from "postgres";

import { legacySeedMerchbaseUserId } from "./plan.ts";
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
    await clearSeededData(transaction, plan);

    for (const table of plan.tables) {
      // biome-ignore lint/performance/noAwaitInLoops: Tables insert in foreign-key order, so each write waits for its parent.
      await insertTableRows(transaction, table);
    }

    await grantOperatorRole(transaction);
  });
}

async function clearSeededData(
  transaction: postgres.TransactionSql,
  plan: DevSeedPlan
): Promise<void> {
  for (const table of seedClearOrder) {
    // biome-ignore lint/performance/noAwaitInLoops: The clear is ordered so every child table empties before its parent.
    await transaction.unsafe(`delete from ${table}`);
  }

  // Role assignments hold a plain foreign key to `account`, so the replaced
  // accounts' roles go first or the delete below is refused.
  await transaction`
    delete from role_assignment
    where account_id in (select id from account where ${matchReplacedAccount(transaction, plan)})
  `;
  await transaction`delete from account where ${matchReplacedAccount(transaction, plan)}`;
}

/**
 * The account rows this run replaces, matched two ways. The first is the seed's
 * own owner, which is the whole story on a database this seed has filled since
 * the Dev Sign-In cutover. The second is the row a pre-cutover seed left at the
 * very id this run is about to insert: the id comes from the seeded RNG, so it
 * is identical across the cutover while the owner is not, and matching on owner
 * alone leaves that row in place for the insert to collide with on
 * `account_pkey`. Both arms are exact — this run's own deterministic id under
 * the one known fixture owner — so a developer's Clerk-created account is never
 * in range.
 */
function matchReplacedAccount(transaction: postgres.TransactionSql, plan: DevSeedPlan) {
  return transaction`
    merchbase_user_id = ${plan.merchbaseUserId}
      or (id = ${plan.accountId} and merchbase_user_id = ${legacySeedMerchbaseUserId})
  `;
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
