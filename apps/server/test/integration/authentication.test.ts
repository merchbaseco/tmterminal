import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createClerkAccessWebhookHandler, ServiceAccessError } from "@merchbaseco/access";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { createAccessProjectionStore } from "../../src/queries/access-projection-store.ts";
import { resolveMerchbaseAccount } from "../../src/queries/account-repository.ts";
import { reconcileActiveProjectionAccess } from "../../src/services/access-reconciliation.ts";
import { authorizedAccess, fakeTmterminalAccess } from "../fake-access.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const signingSecret = `whsec_${Buffer.from("tmterminal-test-secret").toString("base64")}`;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 1, prepare: false });

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

describe("centralized account authentication", () => {
  test("resolves stable service accounts and preserves session preferences", async () => {
    const server = await buildServer({
      access: accessForCredentials(),
      databaseUrl,
      logger: false,
    });

    try {
      const first = await request(server, "/api/trpc/account.me", "session-one");
      const second = await request(server, "/api/trpc/account.me", "session-one");
      const preferences = {
        defaultMatch: "exact",
        defaultRegistered: "yes",
        defaultSort: "newest-activity",
        defaultStatus: "live",
        defaultType: "text",
        pageSize: 50,
        resultDensity: "comfortable",
      };
      const updated = await server.inject({
        headers: {
          authorization: "Bearer session-one",
          "content-type": "application/json",
        },
        method: "POST",
        payload: preferences,
        url: "/api/trpc/account.preferences.update",
      });
      const [stored] = await database<
        Array<{ merchbaseUserId: string; searchPreferences: Record<string, unknown> }>
      >`
        select
          merchbase_user_id as "merchbaseUserId",
          search_preferences as "searchPreferences"
        from account
      `;

      expect(first.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(first.json().result.data).toEqual({
        accountId: expect.any(String),
        credential: { type: "session" },
      });
      expect(updated.statusCode).toBe(200);
      expect(stored).toEqual({
        merchbaseUserId: "mbu_session_one",
        searchPreferences: preferences,
      });
    } finally {
      await server.close();
    }
  });

  test("selects API-key and OAuth credentials only on their intended routes", async () => {
    const server = await buildServer({
      access: accessForCredentials(),
      databaseUrl,
      logger: false,
    });

    try {
      const apiKey = await request(server, "/api/trpc/account.me", "ak_shared");
      const oauth = await request(server, "/api/oauth/trpc/account.me", "oauth-access");
      const oauthOnCustomerRoute = await request(server, "/api/trpc/account.me", "oauth-access");
      const apiKeyOnOauthRoute = await request(server, "/api/oauth/trpc/account.me", "ak_shared");
      const apiKeyPreferences = await request(
        server,
        "/api/trpc/account.preferences.get",
        "ak_shared"
      );

      expect(apiKey.json().result.data.credential).toEqual({ type: "api-key" });
      expect(oauth.json().result.data.credential).toEqual({ type: "oauth" });
      expect(oauthOnCustomerRoute.statusCode).toBe(401);
      expect(apiKeyOnOauthRoute.statusCode).toBe(401);
      expect(apiKeyPreferences.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  test("maps denied and unavailable access without a legacy fallback", async () => {
    const server = await buildServer({
      access: accessForCredentials(),
      databaseUrl,
      logger: false,
    });

    try {
      const denied = await request(server, "/api/trpc/account.me", "denied");
      const unavailable = await request(server, "/api/trpc/account.me", "unavailable");
      const legacy = await request(
        server,
        "/api/trpc/account.me",
        "ttk_00000000-0000-0000-0000-000000000000_legacy"
      );
      const legacyRoute = await request(server, "/api/trpc/account.api-keys.list", "session-one");

      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.data.code).toBe("FORBIDDEN");
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json().error.data.code).toBe("SERVICE_UNAVAILABLE");
      expect(legacy.statusCode).toBe(401);
      expect(legacyRoute.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  test("does not create a service account while a legacy account is unmapped", async () => {
    const legacyAccountId = "00000000-0000-4000-8000-000000000099";
    await database`
      insert into account (id, name)
      values (${legacyAccountId}, 'legacy-account')
    `;

    await expect(resolveMerchbaseAccount(database, "mbu_new")).rejects.toThrow(
      "Existing account mapping is incomplete"
    );
    const accounts = await database<Array<{ id: string; merchbaseUserId: string | null }>>`
      select id, merchbase_user_id as "merchbaseUserId"
      from account
    `;

    expect([...accounts]).toEqual([{ id: legacyAccountId, merchbaseUserId: null }]);
  });

  test("reconciles mapped active projections without provisioning either unmatched side", async () => {
    const store = createAccessProjectionStore(database);
    await Promise.all([
      resolveMerchbaseAccount(database, "mbu_denied"),
      resolveMerchbaseAccount(database, "mbu_granted"),
      resolveMerchbaseAccount(database, "mbu_mapping_only"),
    ]);
    await Promise.all([
      store.apply({
        eventId: "repair-granted",
        projection: {
          access: "granted",
          accessValidUntil: null,
          issuer: "https://clerk.merchbase.co",
          merchbaseUserId: "mbu_granted",
          sourceUpdatedAt: 1000,
          subject: "user_repair_granted",
        },
        type: "upsert",
      }),
      store.apply({
        eventId: "repair-denied",
        projection: {
          access: "not_granted",
          accessValidUntil: null,
          issuer: "https://clerk.merchbase.co",
          merchbaseUserId: "mbu_denied",
          sourceUpdatedAt: 1000,
          subject: "user_repair_denied",
        },
        type: "upsert",
      }),
      store.apply({
        eventId: "repair-projection-only",
        projection: {
          access: "granted",
          accessValidUntil: null,
          issuer: "https://clerk.merchbase.co",
          merchbaseUserId: "mbu_projection_only",
          sourceUpdatedAt: 1000,
          subject: "user_repair_projection_only",
        },
        type: "upsert",
      }),
    ]);
    const refreshed: string[] = [];
    const access = fakeTmterminalAccess({
      refresh: (merchbaseUserId) => {
        refreshed.push(merchbaseUserId);
        if (merchbaseUserId === "mbu_denied") {
          return Promise.reject(new ServiceAccessError("access_denied"));
        }
        return Promise.resolve({
          merchbaseUserId,
          principal: { accountId: "00000000-0000-4000-8000-000000000001" },
          service: "tmterminal" as const,
        });
      },
    });

    await expect(reconcileActiveProjectionAccess(database, access.customer)).resolves.toEqual({
      denied: 1,
      granted: 1,
      removed: 0,
      total: 2,
    });
    expect(refreshed.toSorted((left, right) => left.localeCompare(right))).toEqual([
      "mbu_denied",
      "mbu_granted",
    ]);
  });

  test("fails closed when an active projection repair is unavailable", async () => {
    const store = createAccessProjectionStore(database);
    await resolveMerchbaseAccount(database, "mbu_unavailable");
    await store.apply({
      eventId: "repair-unavailable",
      projection: {
        access: "granted",
        accessValidUntil: null,
        issuer: "https://clerk.merchbase.co",
        merchbaseUserId: "mbu_unavailable",
        sourceUpdatedAt: 1000,
        subject: "user_repair_unavailable",
      },
      type: "upsert",
    });
    const access = fakeTmterminalAccess({
      refresh: () => Promise.reject(new ServiceAccessError("access_unavailable")),
    });

    await expect(reconcileActiveProjectionAccess(database, access.customer)).rejects.toThrow(
      "Daily Access Projection reconciliation failed"
    );
  });

  test("continues after a refresh tombstones one active projection", async () => {
    const store = createAccessProjectionStore(database);
    await Promise.all([
      resolveMerchbaseAccount(database, "mbu_removed"),
      resolveMerchbaseAccount(database, "mbu_retained"),
    ]);
    await Promise.all([
      store.apply({
        eventId: "remove-before-repair",
        projection: {
          access: "granted",
          accessValidUntil: null,
          issuer: "https://clerk.merchbase.co",
          merchbaseUserId: "mbu_removed",
          sourceUpdatedAt: 1000,
          subject: "user_removed",
        },
        type: "upsert",
      }),
      store.apply({
        eventId: "retain-before-repair",
        projection: {
          access: "granted",
          accessValidUntil: null,
          issuer: "https://clerk.merchbase.co",
          merchbaseUserId: "mbu_retained",
          sourceUpdatedAt: 1000,
          subject: "user_retained",
        },
        type: "upsert",
      }),
    ]);
    const refreshed: string[] = [];
    const access = fakeTmterminalAccess({
      refresh: async (merchbaseUserId) => {
        refreshed.push(merchbaseUserId);
        if (merchbaseUserId === "mbu_removed") {
          await store.apply({
            eventId: "remove-during-repair",
            identity: {
              issuer: "https://clerk.merchbase.co",
              subject: "user_removed",
            },
            sourceUpdatedAt: 2000,
            type: "remove",
          });
          throw new ServiceAccessError("access_unavailable");
        }
        return {
          merchbaseUserId,
          principal: { accountId: "00000000-0000-4000-8000-000000000001" },
          service: "tmterminal" as const,
        };
      },
    });

    await expect(reconcileActiveProjectionAccess(database, access.customer)).resolves.toEqual({
      denied: 0,
      granted: 1,
      removed: 1,
      total: 2,
    });
    expect(refreshed).toEqual(["mbu_removed", "mbu_retained"]);
  });
});

describe("Clerk projection webhook", () => {
  test("verifies signatures and applies duplicate, out-of-order, and delete events", async () => {
    const store = createAccessProjectionStore(database);
    const invalidated: string[] = [];
    const access = fakeTmterminalAccess({
      webhook: createClerkAccessWebhookHandler({
        issuer: "https://clerk.merchbase.co",
        onIdentityChanged: ({ subject }) => {
          invalidated.push(subject);
        },
        signingSecret,
        store,
      }),
    });
    const server = await buildServer({ access, databaseUrl, logger: false });

    try {
      const latest = clerkEvent("msg-latest", 2000, {
        access: "granted",
        merchbaseUserId: "mbu_webhook",
      });
      const duplicate = await server.inject(latest);
      const duplicateAgain = await server.inject(latest);
      const older = await server.inject(
        clerkEvent("msg-older", 1000, {
          access: "not_granted",
          merchbaseUserId: "mbu_webhook",
        })
      );
      const unsigned = await server.inject({
        headers: { "content-type": "application/json" },
        method: "POST",
        payload: "{}",
        url: "/api/webhooks/clerk",
      });
      const oversized = await server.inject({
        headers: { "content-type": "application/json" },
        method: "POST",
        payload: `"${"x".repeat(1024 * 1024)}"`,
        url: "/api/webhooks/clerk",
      });
      const beforeDelete = await store.findByMerchbaseUserId("mbu_webhook");
      const deleted = await server.inject(deletedClerkEvent("msg-delete"));
      const afterDelete = await store.findByMerchbaseUserId("mbu_webhook");
      const [receiptCount] = await database<Array<{ count: number }>>`
        select count(*)::int as count from access_projection_receipt
      `;

      expect(duplicate.statusCode).toBe(204);
      expect(duplicateAgain.statusCode).toBe(204);
      expect(older.statusCode).toBe(204);
      expect(unsigned.statusCode).toBe(400);
      expect(oversized.statusCode).toBe(413);
      expect(beforeDelete?.access).toBe("granted");
      expect(afterDelete).toBeNull();
      expect(deleted.statusCode).toBe(204);
      expect(receiptCount?.count).toBe(3);
      expect(invalidated).toHaveLength(4);
    } finally {
      await server.close();
    }
  });

  test("enforces one active identity per Merchbase User without retaining a failed receipt", async () => {
    const store = createAccessProjectionStore(database);
    await store.apply({
      eventId: "event-one",
      projection: {
        access: "granted",
        accessValidUntil: null,
        issuer: "https://clerk.merchbase.co",
        merchbaseUserId: "mbu_unique",
        sourceUpdatedAt: 1000,
        subject: "user_one",
      },
      type: "upsert",
    });

    await expect(
      store.apply({
        eventId: "event-conflict",
        projection: {
          access: "granted",
          accessValidUntil: null,
          issuer: "https://clerk.merchbase.co",
          merchbaseUserId: "mbu_unique",
          sourceUpdatedAt: 2000,
          subject: "user_two",
        },
        type: "upsert",
      })
    ).rejects.toThrow();
    const receipts = await database<Array<{ eventId: string }>>`
      select event_id as "eventId" from access_projection_receipt order by event_id
    `;

    expect([...receipts]).toEqual([{ eventId: "event-one" }]);
  });
});

function accessForCredentials() {
  const authorize = async (credential: string, oauth: boolean) => {
    if (credential === "denied") {
      throw new ServiceAccessError("access_denied");
    }
    if (credential === "unavailable") {
      throw new ServiceAccessError("access_unavailable");
    }
    let selection: { kind: "api_key" | "oauth" | "session"; merchbaseUserId: string } | undefined;
    if (credential === "session-one" && !oauth) {
      selection = { kind: "session", merchbaseUserId: "mbu_session_one" };
    } else if (credential === "ak_shared" && !oauth) {
      selection = { kind: "api_key", merchbaseUserId: "mbu_api_key" };
    } else if (credential === "oauth-access" && oauth) {
      selection = { kind: "oauth", merchbaseUserId: "mbu_oauth" };
    }
    if (!selection) {
      throw new ServiceAccessError("unauthenticated");
    }
    const accountId = await resolveMerchbaseAccount(database, selection.merchbaseUserId);
    return authorizedAccess(accountId, selection.merchbaseUserId, selection.kind);
  };

  return fakeTmterminalAccess({
    customer: (credential) => authorize(credential, false),
    oauth: (credential) => authorize(credential, true),
  });
}

function request(server: Awaited<ReturnType<typeof buildServer>>, url: string, credential: string) {
  return server.inject({
    headers: { authorization: `Bearer ${credential}` },
    method: "GET",
    url,
  });
}

function clerkEvent(
  eventId: string,
  sourceUpdatedAt: number,
  input: { access: "granted" | "not_granted"; merchbaseUserId: string }
) {
  return signedWebhook(eventId, {
    data: {
      id: "user_webhook",
      object: "user",
      public_metadata: {
        merchbase: {
          access: input.access,
          accessValidUntil: null,
          userId: input.merchbaseUserId,
        },
      },
      updated_at: sourceUpdatedAt,
    },
    object: "event",
    type: "user.updated",
  });
}

function deletedClerkEvent(eventId: string) {
  return signedWebhook(eventId, {
    data: { deleted: true, id: "user_webhook", object: "user" },
    object: "event",
    type: "user.deleted",
  });
}

function signedWebhook(eventId: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", Buffer.from("tmterminal-test-secret"))
    .update(`${eventId}.${timestamp}.${body}`)
    .digest("base64");
  return {
    headers: {
      "content-type": "application/json",
      "svix-id": eventId,
      "svix-signature": `v1,${signature}`,
      "svix-timestamp": timestamp,
    },
    method: "POST" as const,
    payload: body,
    url: "/api/webhooks/clerk",
  };
}
