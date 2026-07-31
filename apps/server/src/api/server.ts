import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyRequest, type FastifyServerOptions } from "fastify";

import { createConfiguredTmterminalAccess, type TmterminalAccess } from "../auth/service-access.ts";
import { createDatabaseClient } from "../db/client.ts";
import { createOperatorSyncService } from "../services/operator-sync-service.ts";
import { registerClerkWebhook } from "./clerk-webhook.ts";
import { createAppContext } from "./context.ts";
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
  devOperatorMerchbaseUserId = process.env.DEV_OPERATOR_MERCHBASE_USER_ID,
  logger = true,
  nodeEnv = process.env.NODE_ENV,
}: BuildServerOptions) {
  const database = createDatabaseClient(databaseUrl);
  const resolvedAccess = access ?? createConfiguredTmterminalAccess(database);
  const sourceStatus = createOperatorSyncService(database);
  const server = Fastify({ logger });
  const resolvedDevClerkSignIn = resolveDevClerkSignIn(nodeEnv, devClerkSignIn);
  const resolvedDevOperatorMerchbaseUserId = resolveDevOperatorMerchbaseUserId(
    nodeEnv,
    devOperatorMerchbaseUserId
  );

  registerDevClerkSignIn(server, resolvedDevClerkSignIn);
  registerClerkWebhook(server, resolvedAccess.webhook);

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
