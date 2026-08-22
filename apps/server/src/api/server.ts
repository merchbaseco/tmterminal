import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyRequest, type FastifyServerOptions } from "fastify";

import { createConfiguredTmterminalAccess, type TmterminalAccess } from "../auth/service-access.ts";
import { createDatabaseClient } from "../db/client.ts";
import { createTmterminalMcpAuth } from "../mcp/auth.ts";
import { createTmterminalMcpDataSource } from "../mcp/data-source.ts";
import {
  registerTmterminalMcpRoutes,
  resolveMcpResourceUrl,
} from "../mcp/http.ts";
import { createOperatorSyncService } from "../services/operator-sync-service.ts";
import { registerClerkWebhook } from "./clerk-webhook.ts";
import { createAppContext, createAuthenticatedAppContext } from "./context.ts";
import {
  configuredDevClerkSignIn,
  type DevClerkSignIn,
  registerDevClerkSignIn,
} from "./dev-clerk-sign-in.ts";
import { appRouter, authenticatedClientRouter } from "./router.ts";

interface BuildServerOptions {
  access?: TmterminalAccess;
  databaseUrl: string;
  devClerkSignIn?: DevClerkSignIn | null;
  devOperatorMerchbaseUserId?: string;
  logger?: FastifyServerOptions["logger"];
  mcp?: { publishableKey: string; resourceUrl: string } | null;
  nodeEnv?: string;
}

function resolveDevClerkSignIn(
  nodeEnv: string | undefined,
  configured: DevClerkSignIn | null | undefined
) {
  if (nodeEnv === "production") {
    return null;
  }
  return configured === undefined ? configuredDevClerkSignIn() : configured;
}

export function resolveDevOperatorMerchbaseUserId(
  nodeEnv: string | undefined,
  configured: string | undefined
) {
  return nodeEnv === "production" ? undefined : configured;
}

export async function buildServer({
  access,
  databaseUrl,
  devClerkSignIn,
  devOperatorMerchbaseUserId = process.env.TMTERMINAL_DEV_OPERATOR_MERCHBASE_USER_ID,
  logger = true,
  mcp,
  nodeEnv = process.env.NODE_ENV,
}: BuildServerOptions) {
  const database = createDatabaseClient(databaseUrl);
  const resolvedAccess = access ?? createConfiguredTmterminalAccess(database);
  const sourceStatus = createOperatorSyncService(database);
  const server = Fastify({ logger });
  await server.register(cors, { origin: false });
  const resolvedDevClerkSignIn = resolveDevClerkSignIn(nodeEnv, devClerkSignIn);
  const resolvedDevOperatorMerchbaseUserId = resolveDevOperatorMerchbaseUserId(
    nodeEnv,
    devOperatorMerchbaseUserId
  );

  registerDevClerkSignIn(server, resolvedDevClerkSignIn);
  registerClerkWebhook(server, resolvedAccess.webhook);

  const resolvedMcp =
    mcp === undefined && access === undefined ? configuredMcpRoutes(process.env) : (mcp ?? null);
  if (resolvedMcp) {
    await registerTmterminalMcpRoutes(server, {
      auth: createTmterminalMcpAuth(resolvedAccess.oauth),
      createDataSource: ({ accountId }) =>
        createTmterminalMcpDataSource(
          createAuthenticatedAppContext(database, {
            accountId,
            credential: { type: "oauth" },
          })
        ),
      ...resolvedMcp,
    });
  }

  server.get("/api/health", async (_request, reply) => {
    try {
      await database`select 1`;
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  server.get("/api/status", async (_request, reply) => {
    try {
      const status = await sourceStatus.publicStatus();
      reply.header("Cache-Control", "public, max-age=60");
      return status;
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  await server.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: {
      createContext: ({ req }: { req: FastifyRequest }) =>
        createAppContext({
          access: resolvedAccess.customer,
          authorization: req.headers.authorization,
          database,
          devOperatorMerchbaseUserId: resolvedDevOperatorMerchbaseUserId,
        }),
      router: appRouter,
    },
  });

  await server.register(fastifyTRPCPlugin, {
    prefix: "/api/oauth/trpc",
    trpcOptions: {
      createContext: ({ req }: { req: FastifyRequest }) =>
        createAppContext({
          access: resolvedAccess.oauth,
          authorization: req.headers.authorization,
          database,
          devOperatorMerchbaseUserId: resolvedDevOperatorMerchbaseUserId,
        }),
      router: authenticatedClientRouter,
    },
  });

  server.addHook("onClose", async () => {
    await database.end({ timeout: 1 });
  });

  return server;
}

function configuredMcpRoutes(environment: NodeJS.ProcessEnv) {
  const publishableKey = environment.MERCHBASE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) {
    return null;
  }
  return {
    publishableKey,
    resourceUrl: resolveMcpResourceUrl(environment.TMTERMINAL_MCP_RESOURCE_URL),
  };
}
