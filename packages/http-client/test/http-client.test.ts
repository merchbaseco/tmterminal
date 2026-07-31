import { afterEach, expect, test } from "bun:test";

import {
  createTmterminalClient,
  TmterminalError,
  type TrademarkGetInput,
  type TrademarkMatchInput,
  type TrademarkScreenInput,
  type TrademarkSearchInput,
} from "../src/index.ts";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

test("exposes plain promise methods with the configured API key", async () => {
  const authorizations: string[] = [];
  server = Bun.serve({
    fetch(request) {
      authorizations.push(request.headers.get("authorization") ?? "");
      return Response.json({
        result: {
          data: {
            mark: {
              registrationNumber: "0146682",
              serialNumber: "60146682",
              wordMark: "MACHINE-PISTOL",
            },
          },
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const input: TrademarkGetInput = { registrationNumber: "0146682" };
  const client = createTmterminalClient({
    apiKey: "ak_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const result = await client.trademarks.get(input);

  expect(result.mark).toMatchObject({
    registrationNumber: "0146682",
    serialNumber: "60146682",
    wordMark: "MACHINE-PISTOL",
  });
  expect(authorizations).toEqual(["Bearer ak_test_secret"]);
});

test("derives search, match, screen, and list contracts from the server router", async () => {
  const requests: URL[] = [];
  server = Bun.serve({
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      let data: Record<string, unknown> = {
        items: [],
        limit: 25,
        meta: { dataVersion: "7" },
        offset: 0,
        total: 0,
      };
      if (url.pathname.endsWith("marks.search")) {
        data = { ...data, liveMatchCounts: { exact: 0, partial: 0 } };
      } else if (url.pathname.endsWith("marks.match")) {
        data = { meta: { dataVersion: "7" }, texts: [] };
      } else if (url.pathname.endsWith("marks.screen")) {
        data = { meta: { dataVersion: "7" }, queries: [] };
      }
      return Response.json({ result: { data } });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const client = createTmterminalClient({
    apiKey: "ak_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });
  const search: TrademarkSearchInput = {
    match: "both",
    mode: "multi",
    query: "terminal",
    status: "live",
  };
  const match: TrademarkMatchInput = {
    texts: [{ id: "title", text: "terminal club" }],
    type: "text",
  };
  const screen: TrademarkScreenInput = {
    queries: [{ id: "one", query: "terminal club" }],
    type: "text",
  };

  await client.trademarks.search(search);
  await client.trademarks.match(match);
  await client.trademarks.screen(screen);
  await client.trademarks.list();

  expect(requests.map((request) => request.pathname)).toEqual([
    "/api/trpc/marks.search",
    "/api/trpc/marks.match",
    "/api/trpc/marks.screen",
    "/api/trpc/marks.list",
  ]);
  expect(requests.map((request) => JSON.parse(request.searchParams.get("input") ?? "{}"))).toEqual([
    search,
    match,
    screen,
    {},
  ]);
});

test("exposes safe service status without the internal sync namespace", async () => {
  const paths: string[] = [];
  server = Bun.serve({
    fetch(request) {
      paths.push(new URL(request.url).pathname);
      return Response.json({
        result: {
          data: {
            activeState: "idle",
            dataVersion: 7,
            failedCount: 0,
            lastSuccessfulUpdateAt: null,
            latestProcessedDate: "2026-07-21",
            pendingCount: 0,
          },
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const client = createTmterminalClient({
    apiKey: "ak_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const result = await client.status.get();

  expect(result.latestProcessedDate).toBe("2026-07-21");
  expect(paths).toEqual(["/api/trpc/sync.status"]);
});

test("maps transport failures into one stable public error", async () => {
  server = Bun.serve({
    fetch() {
      return Response.json(
        {
          error: {
            code: -32_004,
            data: {
              code: "NOT_FOUND",
              httpStatus: 404,
              path: "marks.get",
              requestId: "request-1",
            },
            message: "Trademark not found",
          },
        },
        { status: 404 }
      );
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const client = createTmterminalClient({
    apiKey: "ak_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const error = await client.trademarks
    .get({ serialNumber: "99999999" })
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(TmterminalError);
  expect(error).toMatchObject({
    code: "NOT_FOUND",
    message: "Trademark not found",
    requestId: "request-1",
    status: 404,
  });
});

test("maps connection failures without a server response", async () => {
  const failedFetch: typeof globalThis.fetch = Object.assign(
    (..._args: Parameters<typeof globalThis.fetch>) =>
      Promise.reject<Response>(new TypeError("Connection refused")),
    { preconnect: globalThis.fetch.preconnect }
  );
  const client = createTmterminalClient({
    apiKey: "ak_test_secret",
    baseUrl: "https://unreachable.example",
    fetch: failedFetch,
  });

  const error = await client.trademarks
    .get({ serialNumber: "99999999" })
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(TmterminalError);
  expect(error).toMatchObject({
    code: "CONNECTION_ERROR",
    status: null,
  });
});
