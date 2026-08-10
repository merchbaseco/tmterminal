import { afterEach, describe, expect, it, mock } from "bun:test";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import type { TmterminalMcpDataSource } from "../../src/mcp/data-source.ts";
import { registerTmterminalMcpRoutes, resolveMcpResourceUrl } from "../../src/mcp/http.ts";

const resourceUrl = "https://tmterminal.merchbase.co/mcp";
const publishableKey = `pk_test_${Buffer.from("clerk.tmterminal.test$").toString("base64url")}`;
const apps: FastifyInstance[] = [];

describe("Trademark Terminal hosted MCP routes", () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("publishes protected-resource metadata at both standard paths", async () => {
    const app = await createApp();

    const responses = await Promise.all(
      ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].map(
        (url) => app.inject({ method: "GET", url })
      )
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        authorization_servers: ["https://clerk.tmterminal.test"],
        resource: resourceUrl,
        resource_name: "Trademark Terminal",
        scopes_supported: ["openid", "email", "profile"],
      });
    }
  });

  it("returns OAuth discovery and rejects API keys", async () => {
    const authorize = mock(async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" }));
    const app = await createApp(authorize);

    const missing = await app.inject({ method: "POST", payload: initializePayload(), url: "/mcp" });
    const apiKey = await app.inject({
      headers: { authorization: "Bearer ak_test" },
      method: "POST",
      payload: initializePayload(),
      url: "/mcp",
    });

    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toContain(
      'resource_metadata="https://tmterminal.merchbase.co/.well-known/oauth-protected-resource/mcp"'
    );
    expect(apiKey.statusCode).toBe(401);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("rejects insecure remote origins before authorization", async () => {
    const authorize = mock(async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" }));
    const app = await createApp(authorize);
    const response = await app.inject({
      headers: { origin: "http://attacker.example" },
      method: "POST",
      payload: initializePayload(),
      url: "/mcp",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json() as unknown).toEqual({ error: "Invalid Origin" });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("answers browser preflight without authentication", async () => {
    const authorize = mock(async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" }));
    const app = await createApp(authorize);
    const response = await app.inject({
      headers: {
        "access-control-request-method": "POST",
        origin: "https://agent.example",
      },
      method: "OPTIONS",
      url: "/mcp",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://agent.example");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("creates a fresh authenticated data source for an MCP request", async () => {
    const createDataSource = mock(() => source());
    const app = await createApp(undefined, createDataSource);
    const response = await app.inject({
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer oauth-token",
        "content-type": "application/json",
      },
      method: "POST",
      payload: initializePayload(),
      url: "/mcp",
    });

    expect(response.statusCode).toBe(200);
    expect(createDataSource).toHaveBeenCalledWith({
      accountId: "account-1",
      merchbaseUserId: "mbu-1",
    });
  });
});

describe("MCP resource URL", () => {
  it("requires one credential-free absolute HTTP /mcp URL", () => {
    expect(resolveMcpResourceUrl("http://localhost:3000/mcp")).toBe("http://localhost:3000/mcp");
    expect(() => resolveMcpResourceUrl("https://user:secret@example.com/mcp")).toThrow();
    expect(() => resolveMcpResourceUrl("https://example.com/other")).toThrow();
  });
});

async function createApp(
  authorize?: () => Promise<{ accountId: string; merchbaseUserId: string }>,
  createDataSource: () => TmterminalMcpDataSource = source
) {
  const app = Fastify();
  apps.push(app);
  await app.register(cors, { origin: false });
  await registerTmterminalMcpRoutes(app, {
    auth: {
      authorize:
        authorize ?? mock(async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" })),
    },
    createDataSource,
    publishableKey,
    resourceUrl,
  });
  return app;
}

function source() {
  return {
    status: { get: async () => ({}) },
    trademarks: {
      get: async () => ({}),
      list: async () => ({}),
      match: async () => ({}),
      screen: async () => ({}),
      search: async () => ({}),
    },
  } as unknown as TmterminalMcpDataSource;
}

function initializePayload() {
  return {
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
      protocolVersion: "2025-06-18",
    },
  };
}
