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

test("calls the typed marks router with the configured API key", async () => {
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
  const input: TmturtleRouterInputs["marks"]["get"] = { serialNumber: "60146682" };
  const client = createTmturtleClient({
    apiKey: "ttk_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const result: TmturtleRouterOutputs["marks"]["get"] = await client.marks.get.query(input);

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
            meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
            offset: 0,
            total: 0,
          },
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const multi: TmturtleRouterInputs["marks"]["search"] = {
    match: "both",
    mode: "multi",
    query: "turtle",
    status: "live",
  };
  const split: TmturtleRouterInputs["marks"]["search"] = {
    mode: "split",
    query: "turtle club",
  };
  const wildcard: TmturtleRouterInputs["marks"]["search"] = {
    mode: "wildcard",
    query: "turtle*",
  };
  const client = createTmturtleClient({
    apiKey: "ttk_test_secret",
    baseUrl: `http://127.0.0.1:${server.port}`,
  });

  const page: TmturtleRouterOutputs["marks"]["search"] = await client.marks.search.query(multi);
  await client.marks.search.query(split);
  await client.marks.search.query(wildcard);

  expect(page).toEqual({
    items: [],
    limit: 25,
    liveMatchCounts: { exact: 0, partial: 0 },
    meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
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
