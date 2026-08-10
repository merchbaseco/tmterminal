import type { IncomingMessage } from "node:http";

import {
  corsHeaders,
  fetchClerkAuthorizationServerMetadata,
  generateClerkProtectedResourceMetadata,
} from "@clerk/mcp-tools/server";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  authenticateMcpRequest,
  type McpAuthDependencies,
  type McpAuthResult,
  TMTERMINAL_MCP_SCOPES,
} from "./auth.ts";
import type { TmterminalMcpDataSource } from "./data-source.ts";
import { createTmterminalMcpServer } from "./server.ts";

export const DEFAULT_MCP_RESOURCE_URL = "https://tmterminal.merchbase.co/mcp";

const protectedResourceBasePath = "/.well-known/oauth-protected-resource";
const authorizationServerBasePath = "/.well-known/oauth-authorization-server";

const mcpCors = {
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "Last-Event-ID",
    "Mcp-Protocol-Version",
    "Mcp-Session-Id",
  ],
  exposedHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  origin: true,
};

const metadataCors = {
  allowedHeaders: "*",
  methods: ["GET", "OPTIONS"],
  origin: "*",
};

export interface RegisterTmterminalMcpRoutesOptions {
  auth: McpAuthDependencies;
  createDataSource: (input: {
    accountId: string;
    merchbaseUserId: string;
  }) => Promise<TmterminalMcpDataSource> | TmterminalMcpDataSource;
  publishableKey: string;
  resourceUrl: string;
}

export function registerTmterminalMcpRoutes(
  fastify: FastifyInstance,
  options: RegisterTmterminalMcpRoutesOptions
) {
  const protectedResourceMetadata = generateClerkProtectedResourceMetadata({
    properties: {
      resource_name: "Trademark Terminal",
      scopes_supported: [...TMTERMINAL_MCP_SCOPES],
    },
    publishableKey: options.publishableKey,
    resourceUrl: options.resourceUrl,
  });

  for (const path of [protectedResourceBasePath, `${protectedResourceBasePath}/mcp`]) {
    fastify.get(path, { config: { cors: metadataCors } }, (_request, reply) =>
      sendJson(reply, protectedResourceMetadata, corsHeaders)
    );
  }

  for (const path of [authorizationServerBasePath, `${authorizationServerBasePath}/mcp`]) {
    fastify.get(path, { config: { cors: metadataCors } }, async (_request, reply) => {
      try {
        const metadata = await fetchClerkAuthorizationServerMetadata({
          publishableKey: options.publishableKey,
        });
        return sendJson(reply, metadata, corsHeaders);
      } catch {
        return reply.status(503).send({ error: "Authorization server metadata unavailable" });
      }
    });
  }

  fastify.options("/mcp", { config: { cors: mcpCors } }, (_request, reply) =>
    reply.status(204).send()
  );

  fastify.route({
    config: { cors: mcpCors },
    handler: (request, reply) => handleMcpRequest(request, reply, options),
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
  });
}

export function resolveMcpResourceUrl(value = DEFAULT_MCP_RESOURCE_URL) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error("MCP_RESOURCE_URL must be an absolute HTTP URL ending in /mcp", { cause });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/mcp" ||
    url.search ||
    url.hash
  ) {
    throw new Error("MCP_RESOURCE_URL must be an absolute HTTP URL ending in /mcp");
  }
  return url.toString();
}

async function handleMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterTmterminalMcpRoutesOptions
) {
  const { origin } = request.headers;
  if (!isAllowedMcpOrigin(origin)) {
    return reply.status(403).send({ error: "Invalid Origin" });
  }

  const authentication = await authenticateMcpRequest(request.headers.authorization, options.auth);
  if (authentication.status !== "authenticated") {
    return sendAuthenticationFailure(reply, authentication, options.resourceUrl);
  }

  const source = await options.createDataSource({
    accountId: authentication.accountId,
    merchbaseUserId: authentication.merchbaseUserId,
  });
  const server = createTmterminalMcpServer(source);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const rawRequest = request.raw as IncomingMessage & { auth?: AuthInfo };
  rawRequest.auth = authentication.authInfo;
  setMcpCorsHeaders(reply, origin);
  reply.hijack();

  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    Promise.allSettled([transport.close(), server.close()]).then(() => undefined);
  };
  reply.raw.once("close", close);
  transport.onclose = () => {
    if (!closed) {
      closed = true;
      server.close().catch(() => undefined);
    }
  };

  try {
    await server.connect(transport);
    await transport.handleRequest(rawRequest, reply.raw, request.body);
  } catch (error) {
    console.error("Trademark Terminal MCP request failed.", error);
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { "content-type": "application/json" });
      reply.raw.end(JSON.stringify({ error: "MCP request failed" }));
    }
  }
}

function sendAuthenticationFailure(
  reply: FastifyReply,
  authentication: Exclude<McpAuthResult, { status: "authenticated" }>,
  resourceUrl: string
) {
  if (authentication.status === "unavailable") {
    return reply.status(503).send({ error: "Authentication service unavailable" });
  }
  if (authentication.status === "forbidden") {
    const scope = authentication.missingScopes.length
      ? `, scope="${authentication.missingScopes.join(" ")}"`
      : "";
    return reply
      .header(
        "WWW-Authenticate",
        `Bearer realm="Trademark Terminal", error="insufficient_scope"${scope}`
      )
      .status(403)
      .send({ error: "Forbidden" });
  }
  return reply
    .header(
      "WWW-Authenticate",
      `Bearer realm="Trademark Terminal", resource_metadata="${protectedResourceMetadataUrl(resourceUrl)}"`
    )
    .status(401)
    .send({ error: "Unauthorized" });
}

function sendJson(reply: FastifyReply, body: unknown, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    reply.header(key, value);
  }
  return reply.send(body);
}

function setMcpCorsHeaders(reply: FastifyReply, origin: string | undefined) {
  if (origin) {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
  }
  reply.header("Access-Control-Allow-Headers", mcpCors.allowedHeaders.join(", "));
  reply.header("Access-Control-Expose-Headers", mcpCors.exposedHeaders.join(", "));
  reply.header("Access-Control-Allow-Methods", mcpCors.methods.join(", "));
}

function isAllowedMcpOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

function protectedResourceMetadataUrl(resourceUrl: string) {
  const url = new URL(resourceUrl);
  return `${url.origin}${protectedResourceBasePath}${url.pathname}`;
}
