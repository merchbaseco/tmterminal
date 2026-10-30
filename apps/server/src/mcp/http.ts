import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { authenticateMcpRequest, type McpAuthDependencies, type McpAuthResult } from "./auth.ts";
import type { TmterminalMcpDataSource } from "./data-source.ts";
import { createTmterminalMcpServer } from "./server.ts";

const protectedResourceBasePath = "/.well-known/oauth-protected-resource";

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
  issuer: string;
  resourceUrl: string;
}

export function registerTmterminalMcpRoutes(
  fastify: FastifyInstance,
  options: RegisterTmterminalMcpRoutesOptions
) {
  for (const path of [protectedResourceBasePath, `${protectedResourceBasePath}/mcp`]) {
    fastify.get(path, { config: { cors: metadataCors } }, (request, reply) => {
      const resourceUrl = resourceUrlForHost(request.headers.host, options.resourceUrl);
      return sendJson(
        reply,
        {
          authorization_servers: [options.issuer],
          bearer_methods_supported: ["header"],
          resource: resourceUrl,
          resource_name: "Trademark Terminal",
        },
        { "Access-Control-Allow-Origin": "*" }
      );
    });
  }

  fastify.options("/mcp", { config: { cors: mcpCors } }, (_request, reply) =>
    reply.status(204).send()
  );

  fastify.route({
    config: { cors: mcpCors },
    handler: (request, reply) =>
      handleMcpRequest(request, reply, {
        ...options,
        resourceUrl: resourceUrlForHost(request.headers.host, options.resourceUrl),
      }),
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
  });
}

function resourceUrlForHost(host: string | undefined, fallback: string) {
  if (host === "tmterminal.merchbase.co" || host === "tmterminal-api.merchbase.co") {
    return `https://${host}/mcp`;
  }
  return fallback;
}

export function resolveMcpResourceUrl(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch (cause) {
    throw new Error("TMTERMINAL_MCP_RESOURCE_URL must be an absolute HTTP URL ending in /mcp", {
      cause,
    });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/mcp" ||
    url.search ||
    url.hash
  ) {
    throw new Error("TMTERMINAL_MCP_RESOURCE_URL must be an absolute HTTP URL ending in /mcp");
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

  const authentication = await authenticateMcpRequest(
    request.headers["cf-access-jwt-assertion"],
    options.auth
  );
  if (authentication.status !== "authenticated") {
    return sendAuthenticationFailure(reply, authentication, options.resourceUrl);
  }

  const source = await options.createDataSource({
    accountId: authentication.accountId,
    merchbaseUserId: authentication.merchbaseUserId,
  });
  const server = createTmterminalMcpServer(source);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const webRequest = toWebRequest(request);
  setMcpCorsHeaders(reply, origin);

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
    const response = await transport.handleRequest(webRequest, {
      authInfo: authentication.authInfo,
      parsedBody: request.body,
    });
    return reply.send(response);
  } catch (error) {
    console.error(
      "Trademark Terminal MCP request failed.",
      error instanceof Error ? error.name : "UnknownError"
    );
    if (!reply.raw.headersSent) {
      return reply.status(500).send({ error: "MCP request failed" });
    }
  }
}

function toWebRequest(request: FastifyRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      for (const part of value) {
        headers.append(name, part);
      }
    }
  }

  const url = new URL(request.url, `${request.protocol}://${request.headers.host ?? "localhost"}`);
  return new Request(url, { headers, method: request.method });
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
