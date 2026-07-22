import { afterEach, expect, test } from "bun:test";

import {
  createTmturtleClient,
  type TmturtleRouterInputs,
  type TmturtleRouterOutputs,
} from "../src/index.ts";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

test("calls the trademark API with the configured API key", async () => {
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
  const input: TmturtleRouterInputs["trademarks"]["get"] = { serialNumber: "60146682" };
  const client = createTmturtleClient({
    apiKey: "ttk_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const result: TmturtleRouterOutputs["trademarks"]["get"] =
    await client.trademarks.get.query(input);

  expect(result.mark).toMatchObject({
    registrationNumber: "0146682",
    serialNumber: "60146682",
    wordMark: "MACHINE-PISTOL",
  });
  expect(authorizations).toEqual(["Bearer ttk_test_secret"]);
});

test("derives every search mode and page type from the server router", async () => {
  const requests: URL[] = [];
  server = Bun.serve({
    fetch(request) {
      requests.push(new URL(request.url));
      return Response.json({
        result: {
          data: {
            items: [],
            limit: 25,
            liveMatchCounts: { exact: 0, partial: 0 },
            meta: { dataVersion: "7" },
            offset: 0,
            total: 0,
          },
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const multi: TmturtleRouterInputs["trademarks"]["search"] = {
    match: "both",
    mode: "multi",
    query: "turtle",
    status: "live",
  };
  const split: TmturtleRouterInputs["trademarks"]["search"] = {
    mode: "split",
    query: "turtle club",
  };
  const wildcard: TmturtleRouterInputs["trademarks"]["search"] = {
    mode: "wildcard",
    query: "turtle*",
  };
  const client = createTmturtleClient({
    apiKey: "ttk_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const page: TmturtleRouterOutputs["trademarks"]["search"] =
    await client.trademarks.search.query(multi);
  await client.trademarks.search.query(split);
  await client.trademarks.search.query(wildcard);

  expect(page).toEqual({
    items: [],
    limit: 25,
    liveMatchCounts: { exact: 0, partial: 0 },
    meta: { dataVersion: "7" },
    offset: 0,
    total: 0,
  });
  expect(requests.map((request) => request.pathname)).toEqual([
    "/api/trpc/marks.search",
    "/api/trpc/marks.search",
    "/api/trpc/marks.search",
  ]);
  expect(requests.map((request) => JSON.parse(request.searchParams.get("input") ?? "{}"))).toEqual([
    multi,
    split,
    wildcard,
  ]);
});

test("derives latest, text matching, and report contracts from the server router", async () => {
  const paths: string[] = [];
  server = Bun.serve({
    fetch(request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      let data: unknown = {
        items: [],
        limit: 25,
        meta: { dataVersion: "0" },
        offset: 0,
        total: 0,
      };
      if (path.endsWith("marks.match-text")) {
        data = { matches: [], meta: { dataVersion: "0" } };
      } else if (path.endsWith("reports.run")) {
        data = {
          from: "2026-07-06",
          items: [],
          limit: 25,
          meta: { dataVersion: "0" },
          offset: 0,
          to: "2026-07-12",
          total: 0,
        };
      }
      return Response.json({ result: { data } });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const client = createTmturtleClient({
    apiKey: "ttk_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });
  const latestInput: TmturtleRouterInputs["trademarks"]["latest"] = {
    limit: 25,
    offset: 0,
  };
  const matchInput: TmturtleRouterInputs["trademarks"]["matchText"] = {
    text: "turtle club",
    type: "text",
  };
  const reportInput: TmturtleRouterInputs["reports"]["run"] = {
    event: "filed",
    window: "previous-week",
  };

  const latest: TmturtleRouterOutputs["trademarks"]["latest"] =
    await client.trademarks.latest.query(latestInput);
  const matches: TmturtleRouterOutputs["trademarks"]["matchText"] =
    await client.trademarks.matchText.query(matchInput);
  const report: TmturtleRouterOutputs["reports"]["run"] =
    await client.reports.run.query(reportInput);

  expect(latest.total).toBe(0);
  expect(matches.matches).toEqual([]);
  expect(report).toMatchObject({ from: "2026-07-06", to: "2026-07-12" });
  expect(paths).toEqual([
    "/api/trpc/marks.latest",
    "/api/trpc/marks.match-text",
    "/api/trpc/reports.run",
  ]);
});

test("exposes safe service status without leaking the internal sync namespace", async () => {
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
  const client = createTmturtleClient({
    apiKey: "ttk_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const result: TmturtleRouterOutputs["status"] = await client.status.query();

  expect(result.latestProcessedDate).toBe("2026-07-21");
  expect(paths).toEqual(["/api/trpc/sync.status"]);
});
