import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function resolveClerkAccount(database: postgres.Sql, clerkUserId: string) {
  return database.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${clerkUserId}, 0))`;

    const [existing] = await transaction<[{ accountId: string }]>`
      select account_id as "accountId"
      from clerk_identity
      where clerk_user_id = ${clerkUserId}
    `;

    if (existing) {
      return existing.accountId;
    }

    const accountId = randomUUID();
    await transaction`insert into account (id) values (${accountId})`;
    await transaction`
      insert into clerk_identity (clerk_user_id, account_id)
      values (${clerkUserId}, ${accountId})
    `;
    return accountId;
  });
}

export async function resolveHostAccount(database: postgres.Sql, name: string) {
  const [account] = await database<[{ id: string }]>`
    insert into account (id, name)
    values (${randomUUID()}, ${name})
    on conflict (name) do update set name = excluded.name
    returning id
  `;

  if (!account) {
    throw new Error("Host account upsert returned no row");
  }

  return account.id;
}

export async function accountIsOperator(database: postgres.Sql, accountId: string) {
  const [assignment] = await database<[{ assigned: boolean }]>`
    select true as assigned
    from role_assignment
    where account_id = ${accountId} and role = 'operator'
  `;
  return assignment?.assigned === true;
}
