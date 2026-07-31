import type postgres from "postgres";

import type { AccountService } from "../api/contracts.ts";
import {
  getSearchPreferences,
  updateSearchPreferences,
} from "../queries/account-preferences-repository.ts";

export function createAccountService(database: postgres.Sql, accountId: string): AccountService {
  return {
    getSearchPreferences() {
      return getSearchPreferences(database, accountId);
    },
    updateSearchPreferences(preferences) {
      return updateSearchPreferences(database, accountId, preferences);
    },
  };
}
