import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export function resolveMerchbaseAccount(database: postgres.Sql, merchbaseUserId: string) {
  return database.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${merchbaseUserId}, 0))`;

    const [existing] = await transaction<[{ accountId: string }]>`
      select id as "accountId"
      from account
      where merchbase_user_id = ${merchbaseUserId}
    `;

    if (existing) {
      return existing.accountId;
    }

    const [unmappedAccount] = await transaction<[{ exists: boolean }]>`
      select true as exists
      from account
      where merchbase_user_id is null
      limit 1
    `;
    if (unmappedAccount) {
      throw new Error("Existing account mapping is incomplete");
    }

    const accountId = randomUUID();
    await transaction`
      insert into account (id, merchbase_user_id)
      values (${accountId}, ${merchbaseUserId})
    `;
    return accountId;
  });
}

export async function accountIsOperator(database: postgres.Sql, accountId: string) {
  const [assignment] = await database<[{ assigned: boolean }]>`
    select true as assigned
    from role_assignment
    where account_id = ${accountId} and role = 'operator'
  `;
  return assignment?.assigned === true;
}
