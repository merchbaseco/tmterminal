import { afterEach, describe, expect, test } from "bun:test";

import { buildServer } from "../../src/api/server.ts";

describe("GET /api/health", () => {
  const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  test("returns a safe unavailable response when PostgreSQL cannot be reached", async () => {
    const server = await buildServer({
      databaseUrl: "postgres://postgres:postgres@127.0.0.1:1/tmterminal",
      logger: false,
    });
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ status: string }>()).toEqual({ status: "unavailable" });
  });

  test("does not expose server stacks from the empty public router", async () => {
    const server = await buildServer({
      databaseUrl: "postgres://postgres:postgres@127.0.0.1:1/tmterminal",
      logger: false,
    });
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/api/trpc/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('"stack"');
  });
});
