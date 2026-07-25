import type postgres from "postgres";

import type { SearchPreferences } from "../account-preferences.ts";

export async function getSearchPreferences(
  database: postgres.Sql,
  accountId: string
): Promise<SearchPreferences> {
  const [account] = await database<[{ searchPreferences: SearchPreferences }]>`
    select search_preferences as "searchPreferences"
    from account
    where id = ${accountId}
  `;

  if (!account) {
    throw new Error(`Account ${accountId} not found while reading search preferences`);
  }
  return account.searchPreferences;
}

export async function updateSearchPreferences(
  database: postgres.Sql,
  accountId: string,
  preferences: SearchPreferences
): Promise<SearchPreferences> {
  const [account] = await database<[{ searchPreferences: SearchPreferences }]>`
    update account
    set search_preferences = ${database.json(preferences)}
    where id = ${accountId}
    returning search_preferences as "searchPreferences"
  `;

  if (!account) {
    throw new Error(`Account ${accountId} not found while updating search preferences`);
  }
  return account.searchPreferences;
}
