import { afterEach, describe, expect, test } from "bun:test";
import type postgres from "postgres";

import { createAppContext } from "../../src/api/context.ts";
import { buildServer } from "../../src/api/server.ts";

test("the configured local sign-in identity receives operator access", async () => {
  const accountId = "3a4fd52d-32e6-41b4-a470-68e4eaeaf423";
  const transaction = async (strings: TemplateStringsArray) =>
    strings.join("").includes("from clerk_identity") ? [{ accountId }] : [];
  const database = Object.assign(async () => [], {
    begin: async (run: (sql: typeof transaction) => Promise<unknown>) => run(transaction),
  }) as unknown as postgres.Sql;

  const context = await createAppContext({
    authorization: "Bearer clerk-session",
    database,
    devOperatorClerkUserId: "user_dev",
    verifyClerkToken: () => Promise.resolve("user_dev"),
  });

  expect(context.operator).toBe(true);
});

describe("POST /api/dev/clerk-sign-in-token", () => {
  const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
  const databaseUrl = "postgres://postgres:postgres@127.0.0.1:1/tmterminal";

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  test("creates a 60-second Clerk ticket only for localhost", async () => {
    const calls: Array<{ expiresInSeconds: number; userId: string }> = [];
    const server = await buildServer({
      databaseUrl,
      devClerkSignIn: {
        createToken: (userId, expiresInSeconds) => {
          calls.push({ expiresInSeconds, userId });
          return Promise.resolve("short-lived-ticket");
        },
        userId: "user_dev",
      },
      logger: false,
      nodeEnv: "development",
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: "127.0.0.1:42332" },
      method: "POST",
      remoteAddress: "127.0.0.1",
      url: "/api/dev/clerk-sign-in-token",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      expiresInSeconds: 60,
      ticket: "short-lived-ticket",
    });
    expect(calls).toEqual([{ expiresInSeconds: 60, userId: "user_dev" }]);
  });

  test("rejects non-local hosts before creating a ticket", async () => {
    let called = false;
    const server = await buildServer({
      databaseUrl,
      devClerkSignIn: {
        createToken: () => {
          called = true;
          return Promise.resolve("unused-ticket");
        },
        userId: "user_dev",
      },
      logger: false,
      nodeEnv: "development",
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: "tmterminal.merchbase.co" },
      method: "POST",
      remoteAddress: "127.0.0.1",
      url: "/api/dev/clerk-sign-in-token",
    });

    expect(response.statusCode).toBe(403);
    expect(called).toBe(false);
  });

  test("rejects a spoofed local Host from a non-loopback peer", async () => {
    let called = false;
    const server = await buildServer({
      databaseUrl,
      devClerkSignIn: {
        createToken: () => {
          called = true;
          return Promise.resolve("unused-ticket");
        },
        userId: "user_dev",
      },
      logger: false,
      nodeEnv: "development",
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: "127.0.0.1:42332" },
      method: "POST",
      remoteAddress: "203.0.113.10",
      url: "/api/dev/clerk-sign-in-token",
    });

    expect(response.statusCode).toBe(403);
    expect(called).toBe(false);
  });

  test("does not register without explicit development configuration", async () => {
    const server = await buildServer({
      databaseUrl,
      devClerkSignIn: null,
      logger: false,
      nodeEnv: "development",
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: "127.0.0.1:42332" },
      method: "POST",
      url: "/api/dev/clerk-sign-in-token",
    });

    expect(response.statusCode).toBe(404);
  });

  test("does not register in production even when configuration is supplied", async () => {
    const server = await buildServer({
      databaseUrl,
      devClerkSignIn: {
        createToken: () => Promise.resolve("unused-ticket"),
        userId: "user_dev",
      },
      logger: false,
      nodeEnv: "production",
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: "127.0.0.1:42332" },
      method: "POST",
      url: "/api/dev/clerk-sign-in-token",
    });

    expect(response.statusCode).toBe(404);
  });
});
