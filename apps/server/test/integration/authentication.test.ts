import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const apiKeyTokenPattern = /^ttk_[0-9a-f-]+_[A-Za-z0-9_-]+$/;
const apiKeyTokenSearchPattern = /ttk_[0-9a-f-]+_[A-Za-z0-9_-]+/;
const sha256Pattern = /^[0-9a-f]{64}$/;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 1, prepare: false });

beforeAll(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

describe("account authentication", () => {
  test("resolves one stable account from the Clerk user ID", async () => {
    const server = await buildServer({
      databaseUrl,
      logger: false,
      verifyClerkToken: async (token) => (token === "alice-session" ? "user_alice" : null),
    });

    try {
      const first = await server.inject({
        headers: { authorization: "Bearer alice-session" },
        method: "GET",
        url: "/api/trpc/account.me",
      });
      const second = await server.inject({
        headers: { authorization: "Bearer alice-session" },
        method: "GET",
        url: "/api/trpc/account.me",
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toEqual(second.json());
      expect(first.json().result.data).toEqual({
        accountId: expect.any(String),
        credential: { type: "clerk" },
      });
    } finally {
      await server.close();
    }
  });

  test("creates a one-time API key that authenticates account.me", async () => {
    const server = await buildServer({
      databaseUrl,
      logger: false,
      verifyClerkToken: async (token) => (token === "alice-session" ? "user_alice" : null),
    });

    try {
      const created = await server.inject({
        headers: {
          authorization: "Bearer alice-session",
          "content-type": "application/json",
        },
        method: "POST",
        payload: { name: "MerchBase" },
        url: "/api/trpc/account.api-keys.create",
      });

      expect(created.statusCode).toBe(200);
      expect(created.json().result.data).toEqual({
        key: {
          createdAt: expect.any(String),
          id: expect.any(String),
          lastUsedAt: null,
          name: "MerchBase",
          status: "active",
          suffix: expect.any(String),
        },
        token: expect.stringMatching(apiKeyTokenPattern),
      });

      const authenticated = await server.inject({
        headers: { authorization: `Bearer ${created.json().result.data.token}` },
        method: "GET",
        url: "/api/trpc/account.me",
      });

      expect(authenticated.statusCode).toBe(200);
      expect(authenticated.json().result.data).toEqual({
        accountId: expect.any(String),
        credential: {
          keyId: created.json().result.data.key.id,
          suffix: created.json().result.data.key.suffix,
          type: "api-key",
        },
      });
    } finally {
      await server.close();
    }
  });

  test("lists only safe key metadata and stores only the SHA-256 secret hash", async () => {
    const server = await buildServer({
      databaseUrl,
      logger: false,
      verifyClerkToken: async (token) => (token === "storage-session" ? "user_storage" : null),
    });

    try {
      const created = await server.inject({
        headers: {
          authorization: "Bearer storage-session",
          "content-type": "application/json",
        },
        method: "POST",
        payload: { name: "Storage proof" },
        url: "/api/trpc/account.api-keys.create",
      });
      const { key, token } = created.json().result.data;
      const listed = await server.inject({
        headers: { authorization: "Bearer storage-session" },
        method: "GET",
        url: "/api/trpc/account.api-keys.list",
      });
      const [stored] = await database<[{ secretHash: string; revokedAt: Date | null }]>`
        select secret_hash as "secretHash", revoked_at as "revokedAt"
        from api_key
        where id = ${key.id}
      `;

      expect(listed.statusCode).toBe(200);
      expect(listed.body).not.toContain(token);
      expect(listed.json().result.data).toEqual([key]);
      expect(stored).toEqual({
        revokedAt: null,
        secretHash: expect.stringMatching(sha256Pattern),
      });
      expect(stored?.secretHash).not.toContain(token.slice(`ttk_${key.id}_`.length));
    } finally {
      await server.close();
    }
  });

  test("revokes keys idempotently and deletes only revoked history", async () => {
    const server = await buildServer({
      databaseUrl,
      logger: false,
      verifyClerkToken: async (token) => (token === "revoke-session" ? "user_revoke" : null),
    });

    try {
      const created = await server.inject({
        headers: {
          authorization: "Bearer revoke-session",
          "content-type": "application/json",
        },
        method: "POST",
        payload: { name: "Revoke proof" },
        url: "/api/trpc/account.api-keys.create",
      });
      const { key, token } = created.json().result.data;
      const deleteKey = () =>
        server.inject({
          headers: {
            authorization: "Bearer revoke-session",
            "content-type": "application/json",
          },
          method: "POST",
          payload: { id: key.id },
          url: "/api/trpc/account.api-keys.delete",
        });
      const activeDelete = await deleteKey();
      const revoke = () =>
        server.inject({
          headers: {
            authorization: "Bearer revoke-session",
            "content-type": "application/json",
          },
          method: "POST",
          payload: { id: key.id },
          url: "/api/trpc/account.api-keys.revoke",
        });
      const first = await revoke();
      const second = await revoke();
      const rejected = await server.inject({
        headers: { authorization: `Bearer ${token}` },
        method: "GET",
        url: "/api/trpc/account.me",
      });
      const [audit] = await database<[{ revokedAt: Date }]>`
        select revoked_at as "revokedAt" from api_key where id = ${key.id}
      `;
      const deleted = await deleteKey();
      const deletedAgain = await deleteKey();
      const listed = await server.inject({
        headers: { authorization: "Bearer revoke-session" },
        method: "GET",
        url: "/api/trpc/account.api-keys.list",
      });

      expect(activeDelete.statusCode).toBe(404);
      expect(first.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(first.json().result.data.status).toBe("revoked");
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json().error.data.code).toBe("UNAUTHORIZED");
      expect(audit?.revokedAt).toBeInstanceOf(Date);
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json().result.data).toEqual({ id: key.id });
      expect(deletedAgain.statusCode).toBe(404);
      expect(listed.json().result.data).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("rejects cross-account, API-key management, invalid, and dual credentials", async () => {
    const server = await buildServer({
      databaseUrl,
      logger: false,
      verifyClerkToken: (token) => {
        if (token === "owner-session") {
          return Promise.resolve("user_owner");
        }
        if (token === "other-session") {
          return Promise.resolve("user_other");
        }
        return Promise.resolve(null);
      },
    });

    try {
      const created = await server.inject({
        headers: {
          authorization: "Bearer owner-session",
          "content-type": "application/json",
        },
        method: "POST",
        payload: { name: "Boundary proof" },
        url: "/api/trpc/account.api-keys.create",
      });
      const { key, token } = created.json().result.data;
      const crossAccount = await server.inject({
        headers: {
          authorization: "Bearer other-session",
          "content-type": "application/json",
        },
        method: "POST",
        payload: { id: key.id },
        url: "/api/trpc/account.api-keys.revoke",
      });
      const keyManagement = await server.inject({
        headers: { authorization: `Bearer ${token}` },
        method: "GET",
        url: "/api/trpc/account.api-keys.list",
      });
      const invalid = await server.inject({
        headers: {
          authorization:
            "Bearer ttk_00000000-0000-0000-0000-000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
        method: "GET",
        url: "/api/trpc/account.me",
      });
      const dual = await server.inject({
        headers: {
          authorization: `Bearer ${token}`,
          cookie: "__session=owner-session",
        },
        method: "GET",
        url: "/api/trpc/account.me",
      });

      expect(crossAccount.statusCode).toBe(404);
      expect(crossAccount.json().error.data.code).toBe("NOT_FOUND");
      expect(keyManagement.statusCode).toBe(403);
      expect(keyManagement.json().error.data.code).toBe("FORBIDDEN");
      expect(invalid.statusCode).toBe(401);
      expect(invalid.json().error.data.code).toBe("UNAUTHORIZED");
      expect(dual.statusCode).toBe(400);
      expect(dual.json().error.data.code).toBe("BAD_REQUEST");
    } finally {
      await server.close();
    }
  });

  test("bootstraps and recovers a stable host account without placing the token in arguments", async () => {
    async function createHostKey() {
      const child = Bun.spawn(
        ["bun", "run", "--cwd", "apps/server", "api-keys:create", "--name", "merchbase"],
        {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_URL: databaseUrl },
          stderr: "pipe",
          stdout: "pipe",
        }
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const token = stdout.match(apiKeyTokenSearchPattern)?.[0];

      expect(exitCode).toBe(0);
      if (!token) {
        throw new Error("Host API-key command did not return a token");
      }
      expect(stderr).not.toContain(token);
      return token;
    }

    const firstToken = await createHostKey();
    const secondToken = await createHostKey();
    const server = await buildServer({ databaseUrl, logger: false });

    try {
      const first = await server.inject({
        headers: { authorization: `Bearer ${firstToken}` },
        method: "GET",
        url: "/api/trpc/account.me",
      });
      const second = await server.inject({
        headers: { authorization: `Bearer ${secondToken}` },
        method: "GET",
        url: "/api/trpc/account.me",
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().result.data.accountId).toBe(first.json().result.data.accountId);
      expect(secondToken).not.toBe(firstToken);
    } finally {
      await server.close();
    }
  });
});
