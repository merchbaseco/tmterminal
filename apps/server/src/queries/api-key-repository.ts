import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";

const missingSecretHash = "0".repeat(64);
const tokenPattern = /^ttk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export type ApiKeyView = {
  createdAt: Date;
  id: string;
  lastUsedAt: Date | null;
  name: string;
  status: "active" | "revoked";
  suffix: string;
};

type StoredApiKey = {
  accountId: string;
  id: string;
  revokedAt: Date | null;
  secretHash: string;
  suffix: string;
};

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function safeHashMatch(actual: string, expected: string) {
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export async function createApiKey(database: postgres.Sql, accountId: string, name: string) {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const suffix = secret.slice(-6);
  const [key] = await database<[ApiKeyView]>`
    insert into api_key (id, account_id, name, secret_hash, suffix)
    values (${id}, ${accountId}, ${name}, ${hashSecret(secret)}, ${suffix})
    returning
      id,
      name,
      suffix,
      created_at as "createdAt",
      last_used_at as "lastUsedAt",
      'active' as status
  `;

  if (!key) {
    throw new Error("API key insert returned no row");
  }

  return { key, token: `ttk_${id}_${secret}` };
}

export async function authenticateApiKey(
  database: postgres.Sql,
  token: string,
): Promise<{ accountId: string; keyId: string; suffix: string } | null> {
  const match = token.match(tokenPattern);
  const id = match?.[1];
  const secret = match?.[2] ?? "";
  const [stored] = id
    ? await database<[StoredApiKey]>`
        select
          id,
          account_id as "accountId",
          secret_hash as "secretHash",
          suffix,
          revoked_at as "revokedAt"
        from api_key
        where id = ${id}
      `
    : [];
  const validSecret = safeHashMatch(hashSecret(secret), stored?.secretHash ?? missingSecretHash);

  if (!stored || !validSecret || stored.revokedAt) {
    return null;
  }

  await database`
    update api_key
    set last_used_at = now()
    where id = ${stored.id}
      and (last_used_at is null or last_used_at < now() - interval '5 minutes')
  `;

  return { accountId: stored.accountId, keyId: stored.id, suffix: stored.suffix };
}

export async function listApiKeys(database: postgres.Sql, accountId: string) {
  return database<ApiKeyView[]>`
    select
      id,
      name,
      suffix,
      created_at as "createdAt",
      last_used_at as "lastUsedAt",
      case when revoked_at is null then 'active' else 'revoked' end as status
    from api_key
    where account_id = ${accountId}
    order by created_at desc, id
  `;
}

export async function revokeApiKey(database: postgres.Sql, accountId: string, id: string) {
  const [key] = await database<[ApiKeyView]>`
    update api_key
    set revoked_at = coalesce(revoked_at, now())
    where id = ${id} and account_id = ${accountId}
    returning
      id,
      name,
      suffix,
      created_at as "createdAt",
      last_used_at as "lastUsedAt",
      'revoked' as status
  `;
  return key ?? null;
}
