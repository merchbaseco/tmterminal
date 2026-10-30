import { afterEach, describe, expect, it, mock } from "bun:test";
import { request as httpRequest } from "node:http";
import cors from "@fastify/cors";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Fastify, { type FastifyInstance } from "fastify";

import type { TmterminalMcpDataSource } from "../../src/mcp/data-source.ts";
import { registerTmterminalMcpRoutes, resolveMcpResourceUrl } from "../../src/mcp/http.ts";

const resourceUrl = "https://tmterminal.merchbase.co/mcp";
const issuer = "https://example.cloudflareaccess.com";
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
        authorization_servers: ["https://example.cloudflareaccess.com"],
        resource: resourceUrl,
        resource_name: "Trademark Terminal",
      });
    }
  });

  it("returns OAuth discovery and rejects API keys", async () => {
    const authorize = mock(async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" }));
    const app = await createApp(authorize);

    const missing = await app.inject({ method: "POST", payload: initializePayload(), url: "/mcp" });
    const apiKey = await app.inject({
      headers: { "cf-access-jwt-assertion": "ak_test" },
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

  it("serves nonempty canonical discovery through the authenticated HTTP transport", async () => {
    const app = await createApp();
    const response = await app.inject({
      headers: {
        accept: "application/json, text/event-stream",
        "cf-access-jwt-assertion": "oauth-token",
        "content-type": "application/json",
      },
      method: "POST",
      payload: { id: 2, jsonrpc: "2.0", method: "tools/list" },
      url: "/mcp",
    });

    expect(response.statusCode).toBe(200);
    const data = response.body.split("\n").find((line) => line.startsWith("data: "));
    expect(data).toBeDefined();
    expect(JSON.parse(data?.slice(6) ?? "null")).toMatchObject({
      id: 2,
      result: {
        tools: [
          {
            inputSchema: { properties: { serialNumber: { pattern: "^\\d{8}$" } } },
            name: "tmterminal_get",
          },
          {
            inputSchema: { properties: { query: { minLength: 1 } }, required: ["query", "mode"] },
            name: "tmterminal_search",
          },
          { inputSchema: { required: ["text"] }, name: "tmterminal_screen" },
        ],
      },
    });
  });

  it("creates a fresh authenticated data source for an MCP request", async () => {
    const createDataSource = mock(() => source());
    const app = await createApp(undefined, createDataSource);
    const response = await app.inject({
      headers: {
        accept: "application/json, text/event-stream",
        "cf-access-jwt-assertion": "oauth-token",
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

  it("serves initialize and tools/list to an MCP client over HTTP", async () => {
    const app = await createApp();
    const url = new URL("/mcp", await app.listen({ host: "127.0.0.1", port: 0 }));
    const client = new Client({ name: "tmterminal-mcp-http-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { "cf-access-jwt-assertion": "oauth-token" } },
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "tmterminal_get",
        "tmterminal_search",
        "tmterminal_screen",
      ]);
    } finally {
      await client.close();
    }
  });

  it("cleans up when an HTTP client closes an MCP response after parsing the request", async () => {
    let resumeHandler!: () => void;
    const handlerGate = new Promise<void>((resolve) => {
      resumeHandler = resolve;
    });
    let notifyHandlerStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      notifyHandlerStarted = resolve;
    });
    const app = Fastify();
    apps.push(app);
    app.addHook("preHandler", async (request) => {
      if (request.url === "/mcp") {
        notifyHandlerStarted();
        await handlerGate;
      }
    });
    await app.register(cors, { origin: false });
    await registerTmterminalMcpRoutes(app, {
      auth: { authorize: mock(async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" })) },
      createDataSource: source,
      issuer,
      resourceUrl,
    });

    const address = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
    const responseStarted = new Promise<void>((resolve, reject) => {
      const client = httpRequest(
        {
          headers: {
            accept: "application/json, text/event-stream",
            "cf-access-jwt-assertion": "oauth-token",
            "content-type": "application/json",
          },
          hostname: address.hostname,
          method: "POST",
          path: "/mcp",
          port: Number(address.port),
        },
        (response) => {
          response.on("error", () => undefined);
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Expected HTTP 200, got ${response.statusCode ?? "no status"}`));
            return;
          }
          response.once("data", () => {
            response.destroy();
            resolve();
          });
        }
      );
      client.on("error", reject);
      client.end(JSON.stringify(initializePayload()));
    });

    try {
      await handlerStarted;
      resumeHandler();
      await responseStarted;
      await Bun.sleep(650);
    } finally {
      resumeHandler();
    }
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
    issuer,
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
