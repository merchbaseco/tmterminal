import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 1 });

beforeAll(async () => {
  await database.unsafe("drop schema if exists drizzle cascade");
  await database.unsafe("drop table if exists role_assignment, api_key, clerk_identity, account cascade");
  await database.unsafe("drop extension if exists pg_trgm cascade");
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
        method: "GET",
        url: "/api/trpc/account.me",
        headers: { authorization: "Bearer alice-session" },
      });
      const second = await server.inject({
        method: "GET",
        url: "/api/trpc/account.me",
        headers: { authorization: "Bearer alice-session" },
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
        method: "POST",
        url: "/api/trpc/account.api-keys.create",
        headers: {
          authorization: "Bearer alice-session",
          "content-type": "application/json",
        },
        payload: { name: "MerchBase" },
      });

      expect(created.statusCode).toBe(200);
      expect(created.json().result.data).toEqual({
        key: {
          id: expect.any(String),
          name: "MerchBase",
          suffix: expect.any(String),
          createdAt: expect.any(String),
          lastUsedAt: null,
          status: "active",
        },
        token: expect.stringMatching(/^ttk_[0-9a-f-]+_[A-Za-z0-9_-]+$/),
      });

      const authenticated = await server.inject({
        method: "GET",
        url: "/api/trpc/account.me",
        headers: { authorization: `Bearer ${created.json().result.data.token}` },
      });

      expect(authenticated.statusCode).toBe(200);
      expect(authenticated.json().result.data).toEqual({
        accountId: expect.any(String),
        credential: {
          type: "api-key",
          keyId: created.json().result.data.key.id,
          suffix: created.json().result.data.key.suffix,
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
        method: "POST",
        url: "/api/trpc/account.api-keys.create",
        headers: {
          authorization: "Bearer storage-session",
          "content-type": "application/json",
        },
        payload: { name: "Storage proof" },
      });
      const { key, token } = created.json().result.data;
      const listed = await server.inject({
        method: "GET",
        url: "/api/trpc/account.api-keys.list",
        headers: { authorization: "Bearer storage-session" },
      });
      const [stored] = await database<[{ secretHash: string; revokedAt: Date | null }]>`
        select secret_hash as "secretHash", revoked_at as "revokedAt"
        from api_key
        where id = ${key.id}
      `;

      expect(listed.statusCode).toBe(200);
      expect(listed.body).not.toContain(token);
      expect(listed.json().result.data).toEqual([key]);
      expect(stored).toEqual({ secretHash: expect.stringMatching(/^[0-9a-f]{64}$/), revokedAt: null });
      expect(stored?.secretHash).not.toContain(token.split("_").at(-1));
    } finally {
      await server.close();
    }
  });

  test("retains idempotently revoked keys and rejects them for authentication", async () => {
    const server = await buildServer({
      databaseUrl,
      logger: false,
      verifyClerkToken: async (token) => (token === "revoke-session" ? "user_revoke" : null),
    });

    try {
      const created = await server.inject({
        method: "POST",
        url: "/api/trpc/account.api-keys.create",
        headers: {
          authorization: "Bearer revoke-session",
          "content-type": "application/json",
        },
        payload: { name: "Revoke proof" },
      });
      const { key, token } = created.json().result.data;
      const revoke = () =>
        server.inject({
          method: "POST",
          url: "/api/trpc/account.api-keys.revoke",
          headers: {
            authorization: "Bearer revoke-session",
            "content-type": "application/json",
          },
          payload: { id: key.id },
        });
      const first = await revoke();
      const second = await revoke();
      const rejected = await server.inject({
        method: "GET",
        url: "/api/trpc/account.me",
        headers: { authorization: `Bearer ${token}` },
      });
      const [audit] = await database<[{ revokedAt: Date }]>`
        select revoked_at as "revokedAt" from api_key where id = ${key.id}
      `;

      expect(first.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(first.json().result.data.status).toBe("revoked");
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json().error.data.code).toBe("UNAUTHORIZED");
      expect(audit?.revokedAt).toBeInstanceOf(Date);
    } finally {
      await server.close();
    }
  });

  test("rejects cross-account, API-key management, invalid, and dual credentials", async () => {
    const server = await buildServer({
      databaseUrl,
      logger: false,
      verifyClerkToken: async (token) => {
        if (token === "owner-session") return "user_owner";
        if (token === "other-session") return "user_other";
        return null;
      },
    });

    try {
      const created = await server.inject({
        method: "POST",
        url: "/api/trpc/account.api-keys.create",
        headers: {
          authorization: "Bearer owner-session",
          "content-type": "application/json",
        },
        payload: { name: "Boundary proof" },
      });
      const { key, token } = created.json().result.data;
      const crossAccount = await server.inject({
        method: "POST",
        url: "/api/trpc/account.api-keys.revoke",
        headers: {
          authorization: "Bearer other-session",
          "content-type": "application/json",
        },
        payload: { id: key.id },
      });
      const keyManagement = await server.inject({
        method: "GET",
        url: "/api/trpc/account.api-keys.list",
        headers: { authorization: `Bearer ${token}` },
      });
      const invalid = await server.inject({
        method: "GET",
        url: "/api/trpc/account.me",
        headers: { authorization: "Bearer ttk_00000000-0000-0000-0000-000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      });
      const dual = await server.inject({
        method: "GET",
        url: "/api/trpc/account.me",
        headers: {
          authorization: `Bearer ${token}`,
          cookie: "__session=owner-session",
        },
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
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const token = stdout.match(/ttk_[0-9a-f-]+_[A-Za-z0-9_-]+/)?.[0];

      expect(exitCode).toBe(0);
      expect(token).toBeDefined();
      expect(stderr).not.toContain(token ?? "missing-token");
      return token!;
    }

    const firstToken = await createHostKey();
    const secondToken = await createHostKey();
    const server = await buildServer({ databaseUrl, logger: false });

    try {
      const first = await server.inject({
        method: "GET",
        url: "/api/trpc/account.me",
        headers: { authorization: `Bearer ${firstToken}` },
      });
      const second = await server.inject({
        method: "GET",
        url: "/api/trpc/account.me",
        headers: { authorization: `Bearer ${secondToken}` },
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
