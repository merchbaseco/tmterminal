import { afterEach, expect, test } from "bun:test";
import { ServiceAccessError } from "@merchbaseco/access";
import { buildServer } from "../../src/api/server.ts";
import { authorizedAccess, fakeTmterminalAccess } from "../fake-access.ts";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const app = async (mcp: { issuer: string; resourceUrl: string } | null = null) => {
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
    mcp,
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
  const apiAudienceOnInteractiveHost = await server.inject({
    headers: { "cf-access-jwt-assertion": "api", host: "tmterminal.merchbase.co" },
    url: "/api/trpc/account.me",
  });
  expect(apiAudienceOnInteractiveHost.statusCode).toBe(401);
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

test("hosted MCP uses the API audience on the canonical and alias hosts", async () => {
  const server = await app({
    issuer: "https://example.cloudflareaccess.com",
    resourceUrl: "https://tmterminal.merchbase.co/mcp",
  });
  const hosts = ["tmterminal.merchbase.co", "tmterminal-api.merchbase.co"];
  const responses = await Promise.all(
    hosts.map((host) =>
      server.inject({
        headers: {
          accept: "application/json, text/event-stream",
          "cf-access-jwt-assertion": "api",
          "content-type": "application/json",
          host,
        },
        method: "POST",
        payload: {
          id: 1,
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
            protocolVersion: "2025-06-18",
          },
        },
        url: "/mcp",
      })
    )
  );

  expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
});

test("hosted MCP metadata and challenges match the exact requested host", async () => {
  const server = await app({
    issuer: "https://example.cloudflareaccess.com",
    resourceUrl: "https://tmterminal.merchbase.co/mcp",
  });
  const hosts = ["tmterminal.merchbase.co", "tmterminal-api.merchbase.co"];
  const metadataPaths = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ];
  const metadata = await Promise.all(
    hosts.flatMap((host) => metadataPaths.map((url) => server.inject({ headers: { host }, url })))
  );
  const challenges = await Promise.all(
    hosts.map((host) =>
      server.inject({
        headers: { host },
        method: "POST",
        payload: {},
        url: "/mcp",
      })
    )
  );

  for (const [index, host] of hosts.entries()) {
    const resourceUrl = `https://${host}/mcp`;
    const metadataOffset = index * metadataPaths.length;
    for (const response of metadata.slice(metadataOffset, metadataOffset + metadataPaths.length)) {
      expect(response?.statusCode).toBe(200);
      expect(response?.json().resource).toBe(resourceUrl);
      expect(response?.json().authorization_servers).toEqual([
        "https://example.cloudflareaccess.com",
      ]);
    }
    expect(challenges[index]?.statusCode).toBe(401);
    expect(challenges[index]?.headers["www-authenticate"]).toContain(
      `resource_metadata="https://${host}/.well-known/oauth-protected-resource/mcp"`
    );
  }
});

test("hosted MCP rejects untrusted Host even with a trusted forwarded host", async () => {
  const server = await app({
    issuer: "https://example.cloudflareaccess.com",
    resourceUrl: "https://tmterminal.merchbase.co/mcp",
  });
  const response = await server.inject({
    headers: {
      "cf-access-jwt-assertion": "api",
      host: "attacker.example",
      "x-forwarded-host": "tmterminal.merchbase.co",
    },
    method: "POST",
    payload: {},
    url: "/mcp",
  });

  expect(response.statusCode).toBe(401);
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
