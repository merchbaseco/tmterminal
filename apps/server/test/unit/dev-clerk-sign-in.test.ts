import { afterEach, describe, expect, test } from "bun:test";

import { buildServer } from "../../src/api/server.ts";

describe("POST /api/dev/clerk-sign-in-token", () => {
  const servers: Array<Awaited<ReturnType<typeof buildServer>>> = [];
  const databaseUrl = "postgres://postgres:postgres@127.0.0.1:1/tmturtle";

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  test("creates a 60-second Clerk ticket only for localhost", async () => {
    const calls: Array<{ expiresInSeconds: number; userId: string }> = [];
    const server = await buildServer({
      databaseUrl,
      devClerkSignIn: {
        createToken: async (userId, expiresInSeconds) => {
          calls.push({ expiresInSeconds, userId });
          return "short-lived-ticket";
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
        createToken: async () => {
          called = true;
          return "unused-ticket";
        },
        userId: "user_dev",
      },
      logger: false,
      nodeEnv: "development",
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: "tmturtle.merchbase.co" },
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
        createToken: async () => {
          called = true;
          return "unused-ticket";
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
        createToken: async () => "unused-ticket",
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
