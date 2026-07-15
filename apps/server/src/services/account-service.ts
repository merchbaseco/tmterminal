import type postgres from "postgres";

import type { AccountService } from "../api/contracts.ts";
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
    async listApiKeys() {
      return (await listApiKeys(database, accountId)).map(publicApiKey);
    },
    async revokeApiKey(id: string) {
      const key = await revokeStoredApiKey(database, accountId, id);
      return key ? publicApiKey(key) : null;
    },
  };
}
