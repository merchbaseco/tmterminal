import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyRequest, type FastifyServerOptions } from "fastify";

import { createClerkVerifier, type VerifyClerkToken } from "../auth/clerk-verifier.ts";
import { createDatabaseClient } from "../db/client.ts";
import { appRouter, createAppContext } from "./router.ts";

type BuildServerOptions = {
  databaseUrl: string;
  logger?: FastifyServerOptions["logger"];
  verifyClerkToken?: VerifyClerkToken;
};

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
  logger = true,
  verifyClerkToken = configuredClerkVerifier(),
}: BuildServerOptions) {
  const database = createDatabaseClient(databaseUrl);
  const server = Fastify({ logger });

  server.get("/api/health", async (_request, reply) => {
    try {
      await database`select 1`;
      return { status: "ready" };
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
