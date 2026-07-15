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
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      authorizations.push(request.headers.get("authorization") ?? "");
      return Response.json({
        result: {
          data: {
            mark: { serialNumber: "60146682", registrationNumber: "0146682", wordMark: "MACHINE-PISTOL" },
          },
        },
      });
    },
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
