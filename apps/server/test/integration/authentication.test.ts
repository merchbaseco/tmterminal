import { afterAll, beforeEach, expect, test } from "bun:test";
import { applyAccessSnapshot, createCloudflareServiceAccess } from "@merchbaseco/access";
import postgres from "postgres";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { createAccessProjectionStore } from "../../src/queries/access-projection-store.ts";
import { resolveMerchbaseAccount } from "../../src/queries/account-repository.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TMTERMINAL_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Isolated test database required");
}
const database = postgres(databaseUrl, { max: 1, prepare: false });
const issuer = "https://example.cloudflareaccess.com";
const authorityOrigin = "https://access-internal.merchbase.co";
const uid = "mbu_preserved";
beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});
afterAll(async () => {
  await database.end({ timeout: 1 });
});
test("multiple Cloudflare aliases share a canonical grant and preserve product account identity", async () => {
  const accountId = await resolveMerchbaseAccount(database, uid);
  const projections = createAccessProjectionStore(database, authorityOrigin);
  const snapshot = {
    access: "granted",
    accessValidUntil: null,
    eventId: "snapshot_one",
    identities: [
      { kind: "person", state: "active", subject: "person-one" },
      { expiresAt: null, kind: "api_key", state: "active", subject: "client-one.access" },
    ],
    issuer,
    merchbaseUserId: uid,
    service: "tmterminal",
    sourceUpdatedAt: 100,
  };
  await applyAccessSnapshot({
    authorityOrigin,
    issuer,
    projections,
    service: "tmterminal",
    snapshot,
  });
  expect((await projections.findByMerchbaseUserId(uid))?.access).toBe("granted");
  let kind: "person" | "machine" = "person";
  const access = createCloudflareServiceAccess({
    acceptedPrincipalKinds: ["person", "api_key"],
    authorityOrigin,
    issuer,
    loadSnapshot: () => Promise.reject(new Error("Warm requests must remain local")),
    projections,
    resolveServicePrincipal: async ({ merchbaseUserId }) => ({
      accountId: await resolveMerchbaseAccount(database, merchbaseUserId),
    }),
    service: "tmterminal",
    verifier: {
      verify: async () =>
        kind === "person"
          ? {
              expiresAt: Number.MAX_SAFE_INTEGER,
              issuedAt: 1,
              issuer,
              kind: "person",
              subject: "person-one",
            }
          : {
              clientId: "client-one.access",
              expiresAt: Number.MAX_SAFE_INTEGER,
              issuedAt: 1,
              issuer,
              kind: "machine",
            },
    },
  });
  expect((await access.authorize("verified-person")).principal.accountId).toBe(accountId);
  kind = "machine";
  expect((await access.authorize("verified-machine")).principal.accountId).toBe(accountId);
  await applyAccessSnapshot({
    authorityOrigin,
    issuer,
    projections,
    service: "tmterminal",
    snapshot: { ...snapshot, access: "not_granted", eventId: "snapshot_two", sourceUpdatedAt: 101 },
  });
  await expect(access.authorize("verified-machine")).rejects.toMatchObject({
    code: "access_denied",
  });
  await applyAccessSnapshot({
    authorityOrigin,
    issuer,
    projections,
    service: "tmterminal",
    snapshot,
  });
  await expect(access.evaluateAccess(uid)).rejects.toMatchObject({ code: "access_denied" });
  expect(await resolveMerchbaseAccount(database, uid)).toBe(accountId);
  const rows = await database`select count(*)::int as count from account`;
  expect(rows[0]?.count).toBe(1);
});
