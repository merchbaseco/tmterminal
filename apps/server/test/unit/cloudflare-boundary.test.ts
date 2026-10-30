import { afterEach, expect, test } from "bun:test";
import { ServiceAccessError } from "@merchbaseco/access";
import { buildServer } from "../../src/api/server.ts";
import { authorizedAccess, fakeTmterminalAccess } from "../fake-access.ts";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const app = async () => {
  const access = fakeTmterminalAccess({
    api: (token) =>
      token === "api"
        ? Promise.resolve(authorizedAccess("account-one", "mbu_owner", "oauth"))
        : Promise.reject(new ServiceAccessError("unauthenticated")),
    interactive: (token) =>
      token === "interactive"
        ? Promise.resolve(authorizedAccess("account-one", "mbu_owner", "session"))
        : Promise.reject(new ServiceAccessError("unauthenticated")),
  });
  access.development = false;
  const server = await buildServer({
    access,
    databaseUrl: "postgres://test:test@127.0.0.1:1/test",
    logger: false,
    mcp: null,
    nodeEnv: "production",
  });
  servers.push(server);
  return server;
};
test("public API person credentials cannot use interactive preferences or operator procedures", async () => {
  const server = await app();
  await Promise.all(
    ["account.preferences.get", "ops.sync.status"].map(async (path) => {
      const response = await server.inject({
        headers: { "cf-access-jwt-assertion": "api", host: "tmterminal-api.merchbase.co" },
        url: `/api/trpc/${path}`,
      });
      expect(response.statusCode).toBe(403);
    })
  );
  const account = await server.inject({
    headers: { "cf-access-jwt-assertion": "api", host: "tmterminal-api.merchbase.co" },
    url: "/api/trpc/account.me",
  });
  expect(account.statusCode).toBe(200);
  expect(account.json().result.data.credential).toEqual({ type: "oauth" });
});
test("interactive audience is selected only from the exact Host", async () => {
  const server = await app();
  const valid = await server.inject({
    headers: { "cf-access-jwt-assertion": "interactive", host: "tmterminal.merchbase.co" },
    url: "/api/session",
  });
  expect(valid.statusCode).toBe(200);
  await Promise.all(
    ["attacker.example", "localhost", "tmterminal.merchbase.co."].map(async (host) => {
      const response = await server.inject({
        headers: {
          "cf-access-jwt-assertion": "interactive",
          host,
          "x-forwarded-host": "tmterminal.merchbase.co",
        },
        url: "/api/session",
      });
      expect(response.statusCode).toBe(401);
    })
  );
  expect(
    (
      await server.inject({
        headers: { "cf-access-jwt-assertion": "interactive", host: "tmterminal-api.merchbase.co" },
        url: "/api/session",
      })
    ).statusCode
  ).toBe(404);
  expect(
    (
      await server.inject({
        headers: { "cf-access-jwt-assertion": "api", host: "tmterminal.merchbase.co" },
        url: "/api/session",
      })
    ).statusCode
  ).toBe(401);
});
test("customer requests reject seller headers and cross-origin interactive mutations", async () => {
  const server = await app();
  expect(
    (
      await server.inject({
        headers: {
          "cf-access-jwt-assertion": "interactive",
          host: "tmterminal.merchbase.co",
          "x-merchbase-user-id": "",
        },
        url: "/api/session",
      })
    ).statusCode
  ).toBe(401);
  expect(
    (
      await server.inject({
        headers: {
          "cf-access-jwt-assertion": "interactive",
          host: "tmterminal.merchbase.co",
          origin: "https://attacker.example",
        },
        method: "POST",
        payload: {},
        url: "/api/trpc/account.preferences.update",
      })
    ).statusCode
  ).toBe(403);
});
test("internal snapshot transport is isolated from customer and browser hosts", async () => {
  const server = await app();
  await Promise.all(
    ["tmterminal.merchbase.co", "tmterminal-api.merchbase.co"].map(async (host) => {
      expect(
        (
          await server.inject({
            headers: { host, origin: "https://tmterminal.merchbase.co" },
            method: "POST",
            payload: {},
            url: "/api/internal/access-snapshot",
          })
        ).statusCode
      ).toBe(404);
    })
  );
  expect(
    (
      await server.inject({
        headers: { host: "tmterminal-internal.merchbase.co" },
        method: "POST",
        payload: {},
        url: "/api/internal/access-snapshot",
      })
    ).statusCode
  ).toBe(204);
  expect(
    (
      await server.inject({
        headers: { "cf-access-jwt-assertion": "api", host: "tmterminal-internal.merchbase.co" },
        url: "/api/trpc/account.me",
      })
    ).statusCode
  ).toBe(404);
  expect(
    (
      await server.inject({
        headers: { host: "tmterminal-api.merchbase.co" },
        method: "POST",
        url: "/api/webhooks/clerk",
      })
    ).statusCode
  ).toBe(404);
});
