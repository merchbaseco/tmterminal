import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyServerOptions } from "fastify";

import { createDatabaseClient } from "../db/client.ts";
import { appRouter } from "./router.ts";

type BuildServerOptions = {
  databaseUrl: string;
  logger?: FastifyServerOptions["logger"];
};

export async function buildServer({ databaseUrl, logger = true }: BuildServerOptions) {
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
    trpcOptions: { router: appRouter },
  });

  server.addHook("onClose", async () => {
    await database.end({ timeout: 1 });
  });

  return server;
}
