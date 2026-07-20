import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyRequest, type FastifyServerOptions } from "fastify";

import { createClerkVerifier, type VerifyClerkToken } from "../auth/clerk-verifier.ts";
import { createDatabaseClient } from "../db/client.ts";
import { createOperatorSyncService } from "../services/operator-sync-service.ts";
import { createAppContext } from "./context.ts";
import {
  configuredDevClerkSignIn,
  type DevClerkSignIn,
  registerDevClerkSignIn,
} from "./dev-clerk-sign-in.ts";
import { appRouter } from "./router.ts";

interface BuildServerOptions {
  databaseUrl: string;
  devClerkSignIn?: DevClerkSignIn | null;
  logger?: FastifyServerOptions["logger"];
  nodeEnv?: string;
  verifyClerkToken?: VerifyClerkToken;
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

function configuredClerkVerifier() {
  const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES?.split(",")
    .map((party) => party.trim())
    .filter(Boolean);

  return createClerkVerifier({
    authorizedParties,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
}

export async function buildServer({
  databaseUrl,
  devClerkSignIn,
  logger = true,
  nodeEnv = process.env.NODE_ENV,
  verifyClerkToken = configuredClerkVerifier(),
}: BuildServerOptions) {
  const database = createDatabaseClient(databaseUrl);
  const sourceStatus = createOperatorSyncService(database);
  const server = Fastify({ logger });
  const resolvedDevClerkSignIn = resolveDevClerkSignIn(nodeEnv, devClerkSignIn);

  registerDevClerkSignIn(server, resolvedDevClerkSignIn);

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
          authorization: req.headers.authorization,
          cookie: req.headers.cookie,
          database,
          devOperatorClerkUserId: resolvedDevClerkSignIn?.userId,
          verifyClerkToken,
        }),
      router: appRouter,
    },
  });

  server.addHook("onClose", async () => {
    await database.end({ timeout: 1 });
  });

  return server;
}
