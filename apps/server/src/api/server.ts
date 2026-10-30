import cors from "@fastify/cors";
import { ServiceAccessError } from "@merchbaseco/access";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import { isMcpPath, originAssertion, requestSurface } from "../auth/request-boundary.ts";
import { createConfiguredTmterminalAccess, type TmterminalAccess } from "../auth/service-access.ts";
import { buildRevision } from "../build-revision.ts";
import { createDatabaseClient } from "../db/client.ts";
import { createTmterminalMcpAuth } from "../mcp/auth.ts";
import { createTmterminalMcpDataSource } from "../mcp/data-source.ts";
import { registerTmterminalMcpRoutes, resolveMcpResourceUrl } from "../mcp/http.ts";
import { checkHealth, checkLive, type HealthReport } from "../services/health.ts";
import { createOperatorSyncService } from "../services/operator-sync-service.ts";
import { createAppContext, createAuthenticatedAppContext } from "./context.ts";
import { appRouter } from "./router.ts";

interface BuildServerOptions {
  access?: TmterminalAccess;
  databaseUrl: string;
  devOperatorMerchbaseUserId?: string;
  logger?: FastifyServerOptions["logger"];
  mcp?: { issuer: string; resourceUrl: string } | null;
  nodeEnv?: string;
}

function sendHealth(reply: FastifyReply, report: HealthReport) {
  reply.header("Cache-Control", "no-store");
  switch (report.status) {
    case "ok":
      // biome-ignore assist/source/useSortedKeys: The health body is exact bytes, with status before revision.
      return { status: "ok", revision: buildRevision };
    case "degraded":
      // biome-ignore assist/source/useSortedKeys: The health body is exact bytes, with status before failing and revision last.
      return reply.code(503).send({
        status: "degraded",
        failing: report.failing,
        revision: buildRevision,
      });
    default:
      return report satisfies never;
  }
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
  devOperatorMerchbaseUserId = process.env.TMTERMINAL_DEV_OPERATOR_MERCHBASE_USER_ID,
  logger = true,
  mcp,
  nodeEnv = process.env.NODE_ENV,
}: BuildServerOptions) {
  const database = createDatabaseClient(databaseUrl);
  const resolvedAccess = access ?? (await createConfiguredTmterminalAccess(database, databaseUrl));
  const sourceStatus = createOperatorSyncService(database);
  const redact = [
    "req.headers.authorization",
    "req.headers.cookie",
    'req.headers["cf-access-client-secret"]',
    'req.headers["cf-access-jwt-assertion"]',
  ];
  const server = Fastify({
    logger: logger === false ? false : { ...(typeof logger === "object" ? logger : {}), redact },
  });
  await server.register(cors, { origin: false });
  const resolvedDevOperatorMerchbaseUserId = resolveDevOperatorMerchbaseUserId(
    nodeEnv,
    devOperatorMerchbaseUserId
  );

  server.addHook("onRequest", (request, reply, done) => {
    if (["/health/live", "/api/health", "/api/status"].includes(request.url.split("?")[0] ?? "")) {
      done();
      return;
    }
    try {
      const [path] = request.url.split("?");
      const surface = requestSurface(request.headers, resolvedAccess.development, path);
      if (surface !== "internal" && "x-merchbase-user-id" in request.headers) {
        throw new ServiceAccessError("unauthenticated");
      }
      const snapshot = path === "/api/internal/access-snapshot";
      const discovery = isMcpPath(path);
      if (
        (surface === "internal") !== snapshot ||
        (discovery && surface !== "api" && !resolvedAccess.development)
      ) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (surface === "api" && path === "/api/session") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (
        surface === "interactive" &&
        !resolvedAccess.development &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.headers.origin !== "https://tmterminal.merchbase.co"
      ) {
        return reply.code(403).send({ error: "Invalid Origin" });
      }
    } catch {
      return reply.code(401).send({ error: "Authentication required" });
    }
    done();
  });
  await server.register((snapshotServer, _options, done) => {
    snapshotServer.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_request, body, parseDone) => parseDone(null, body)
    );
    snapshotServer.post("/api/internal/access-snapshot", async (request, reply) => {
      const response = await resolvedAccess.snapshot(
        new Request("https://tmterminal-internal.merchbase.co/api/internal/access-snapshot", {
          body: typeof request.body === "string" ? request.body : "",
          headers: {
            "cf-access-jwt-assertion": originAssertion(request.headers),
            "content-type": request.headers["content-type"] ?? "",
          },
          method: "POST",
        })
      );
      return reply.code(response.status).send(await response.text());
    });
    done();
  });
  server.get("/api/session", async (request, reply) => {
    try {
      await resolvedAccess.interactive.authorize(originAssertion(request.headers));
      return reply.header("Cache-Control", "no-store").send({ authenticated: true });
    } catch (error) {
      let status = 503;
      if (error instanceof ServiceAccessError && error.code === "access_denied") {
        status = 403;
      }
      if (error instanceof ServiceAccessError && error.code === "unauthenticated") {
        status = 401;
      }
      return reply.code(status).send({ authenticated: false });
    }
  });

  const resolvedMcp =
    mcp === undefined && access === undefined ? configuredMcpRoutes(process.env) : (mcp ?? null);
  if (resolvedMcp) {
    await registerTmterminalMcpRoutes(server, {
      auth: createTmterminalMcpAuth(resolvedAccess.mcp),
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

  server.get("/health/live", async (_request, reply) =>
    sendHealth(reply, await checkLive(database))
  );

  server.get("/api/health", async (_request, reply) =>
    sendHealth(reply, await checkHealth(database))
  );

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
          access:
            requestSurface(req.headers, resolvedAccess.development) === "api"
              ? resolvedAccess.api
              : resolvedAccess.interactive,
          assertion: originAssertion(req.headers),
          database,
          devOperatorMerchbaseUserId: resolvedDevOperatorMerchbaseUserId,
        }),
      router: appRouter,
    },
  });

  server.addHook("onClose", async () => {
    await database.end({ timeout: 1 });
  });

  return server;
}

function configuredMcpRoutes(environment: NodeJS.ProcessEnv) {
  const issuer = environment.MERCHBASE_ACCESS_ISSUER?.trim();
  if (!issuer) {
    return null;
  }
  return {
    issuer,
    resourceUrl: resolveMcpResourceUrl(environment.TMTERMINAL_MCP_RESOURCE_URL),
  };
}
