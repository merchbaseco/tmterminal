import type postgres from "postgres";

import type { AccountService } from "../api/contracts.ts";
import {
  getSearchPreferences,
  updateSearchPreferences,
} from "../queries/account-preferences-repository.ts";
import {
  type ApiKeyView,
  createApiKey,
  listApiKeys,
  revokeApiKey as revokeStoredApiKey,
} from "../queries/api-key-repository.ts";

function publicApiKey(key: ApiKeyView) {
  return {
    ...key,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  };
}

export function createAccountService(database: postgres.Sql, accountId: string): AccountService {
  return {
    async createApiKey(name: string) {
      const created = await createApiKey(database, accountId, name);
      return { ...created, key: publicApiKey(created.key) };
    },
    getSearchPreferences() {
      return getSearchPreferences(database, accountId);
    },
    async listApiKeys() {
      return (await listApiKeys(database, accountId)).map(publicApiKey);
    },
    revokeApiKey(id: string) {
      return revokeStoredApiKey(database, accountId, id);
    },
    updateSearchPreferences(preferences) {
      return updateSearchPreferences(database, accountId, preferences);
    },
  };
}
