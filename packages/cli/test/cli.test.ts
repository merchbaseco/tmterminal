import { expect, test } from "bun:test";
import type { TmturtleRouterOutputs } from "@tmturtle/http-client";

import { type CliClient, type CliDependencies, runCli } from "../src/run.ts";

const token =
  "ttk_11111111-1111-4111-8111-111111111111_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const trademark = {
  classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2010-04-08" }],
  goodsServices: [{ text: "pistols", typeCode: "GS0091" }],
  legalDisclaimer:
    "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.",
  mark: {
    filingDate: "1920-09-25",
    markDrawingCode: "3",
    registrationDate: "1921-09-20",
    registrationNumber: "0146682",
    serialNumber: "60146682",
    sourceTransactionDate: "2016-03-16",
    status: "dead",
    statusCode: "626",
    statusDate: "2005-10-11",
    wordMark: "MACHINE-PISTOL",
  },
  owners: [{ entryNumber: "1", partyName: "AUTO ORDNANCE CORPORATION", partyType: "10" }],
  provenance: {
    contributors: [],
    versions: {
      authorityPolicy: "uspto-authority-v1",
      normalization: "uspto-normalization-v1",
      projection: "uspto-projection-v2",
      sourceProfile: "uspto-application-xml-v2.0-v1",
    },
  },
  statusEvents: [],
  type: "design",
} satisfies TmturtleRouterOutputs["trademarks"]["get"];

const searchPage = {
  items: [
    {
      goodsServicesExcerpt: "shirts",
      internationalClasses: ["025"],
      match: "partial",
      owner: "TURTLE GOODS LLC",
      registrationNumber: "7000001",
      serialNumber: "70000001",
      sourceTransactionDate: "2026-07-10",
      status: "dead",
      statusDate: "2026-07-09",
      type: "design",
      wordMark: "TURTLE CLUB",
    },
  ],
  limit: 25,
  liveMatchCounts: { exact: 0, partial: 1 },
  meta: { dataVersion: "7" },
  offset: 0,
  total: 1,
} satisfies TmturtleRouterOutputs["trademarks"]["search"];

type ClientFactory = (options: { apiKey: string; baseUrl: string }) => CliClient;

function dependencies(
  overrides: Partial<Omit<CliDependencies, "createClient">> & {
    createClient?: ClientFactory;
  } = {}
): CliDependencies {
  return {
    createClient: () => {
      throw new Error("Unexpected HTTP client");
    },
    env: {},
    keychain: {
      clear: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
    },
    stdin: "",
    version: "1.0.0",
    ...overrides,
  };
}

function json(result: Awaited<ReturnType<typeof runCli>>) {
  return JSON.parse(result.stdout || result.stderr);
}

function asClient(value: unknown) {
  return value as CliClient;
}

test("no command, --help, help search, and --version are human-readable successes", async () => {
  const root = await runCli([], dependencies());
  const help = await runCli(["--help"], dependencies());
  const searchHelp = await runCli(["help", "search"], dependencies());
  const version = await runCli(["--version"], dependencies());

  expect(root).toEqual(help);
  expect(root.exitCode).toBe(0);
  expect(root.stdout).toContain("Usage: tt [options] [command]");
  expect(root.stdout).toContain("search [options] <query>");
  expect(searchHelp.stdout).toContain("Usage: tt search [options] <query>");
  expect(version).toEqual({ exitCode: 0, stderr: "", stdout: "1.0.0\n" });
});

test("unknown commands return one JSON error on stderr", async () => {
  const result = await runCli(["marks", "search", "turtle"], dependencies());

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(json(result)).toMatchObject({
    error: { code: "BAD_REQUEST", message: expect.stringContaining("unknown command 'marks'") },
    ok: false,
  });
});

test("auth set stores stdin against the explicit normalized origin without echoing it", async () => {
  const stored: Array<{ origin: string; token: string }> = [];
  const result = await runCli(
    ["auth", "set", "--stdin", "--base-url", "https://EXAMPLE.com:443/"],
    dependencies({
      keychain: {
        clear: () => Promise.resolve(),
        get: () => Promise.resolve(null),
        set: (origin, value) => {
          stored.push({ origin, token: value });
          return Promise.resolve();
        },
      },
      stdin: `${token}\n`,
    })
  );

  expect(stored).toEqual([{ origin: "https://example.com", token }]);
  expect(json(result)).toEqual({ data: { origin: "https://example.com" }, ok: true });
  expect(result.stdout).not.toContain(token);
});

test("global origin overrides environment origin", async () => {
  const clients: Array<{ apiKey: string; baseUrl: string }> = [];
  const result = await runCli(
    ["--base-url", "https://explicit.example", "auth", "status"],
    dependencies({
      createClient: (options) => {
        clients.push(options);
        return asClient({
          account: {
            me: {
              query: () =>
                Promise.resolve({
                  accountId: "account-1",
                  credential: { keyId: "key-1", suffix: "AAAAAA", type: "api-key" },
                }),
            },
          },
        });
      },
      env: {
        TMTURTLE_API_KEY: token,
        TMTURTLE_BASE_URL: "https://environment.example",
      },
    })
  );

  expect(clients).toEqual([{ apiKey: token, baseUrl: "https://explicit.example" }]);
  expect(json(result).data).toMatchObject({
    credentialSource: "environment",
    origin: "https://explicit.example",
  });
});

test("auth status uses the selected origin's Keychain credential", async () => {
  const reads: string[] = [];
  const result = await runCli(
    ["auth", "status"],
    dependencies({
      createClient: () =>
        asClient({
          account: {
            me: {
              query: () =>
                Promise.resolve({
                  accountId: "account-2",
                  credential: { keyId: "key-2", suffix: "AAAAAA", type: "api-key" },
                }),
            },
          },
        }),
      env: { TMTURTLE_BASE_URL: "https://service.example/" },
      keychain: {
        clear: () => Promise.resolve(),
        get: (origin) => {
          reads.push(origin);
          return Promise.resolve(token);
        },
        set: () => Promise.resolve(),
      },
    })
  );

  expect(reads).toEqual(["https://service.example"]);
  expect(json(result).data.credentialSource).toBe("keychain");
});

test("auth clear is scoped to the selected origin", async () => {
  const cleared: string[] = [];
  const result = await runCli(
    ["auth", "clear"],
    dependencies({
      env: { TMTURTLE_BASE_URL: "https://SERVICE.example:443/" },
      keychain: {
        clear: (origin) => {
          cleared.push(origin);
          return Promise.resolve();
        },
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
      },
    })
  );

  expect(cleared).toEqual(["https://service.example"]);
  expect(json(result)).toEqual({ data: { origin: "https://service.example" }, ok: true });
});

test("get selects exact serial and registration identities", async () => {
  const serialInputs: unknown[] = [];
  const registrationInputs: unknown[] = [];
  const client = asClient({
    trademarks: {
      get: {
        query: (input: unknown) => {
          serialInputs.push(input);
          return Promise.resolve(trademark);
        },
      },
      getByRegistration: {
        query: (input: unknown) => {
          registrationInputs.push(input);
          return Promise.resolve(trademark);
        },
      },
    },
  });

  const serial = await runCli(
    ["get", "--serial", "60146682"],
    authenticated(() => client)
  );
  const registration = await runCli(
    ["get", "--registration", "0146682"],
    authenticated(() => client)
  );

  expect(serialInputs).toEqual([{ serialNumber: "60146682" }]);
  expect(registrationInputs).toEqual([{ registrationNumber: "0146682" }]);
  expect(json(serial)).toEqual({ data: trademark, ok: true });
  expect(json(registration)).toEqual({ data: trademark, ok: true });
});

test("get rejects missing, ambiguous, and malformed identities before HTTP", async () => {
  const missing = await runCli(["get"], dependencies());
  const ambiguous = await runCli(
    ["get", "--serial", "60146682", "--registration", "0146682"],
    dependencies()
  );
  const malformed = await runCli(["get", "--serial", "6014668"], dependencies());

  expect(json(missing).error.message).toBe("Supply exactly one of --serial or --registration");
  expect(json(ambiguous).error.message).toBe("Supply exactly one of --serial or --registration");
  expect(json(malformed).error.message).toBe("Serial number must be exactly 8 digits");
});

test("search maps Multi filters and stable continuation fields", async () => {
  const inputs: unknown[] = [];
  const result = await runCli(
    [
      "search",
      "Turtle %",
      "--match",
      "partial",
      "--status",
      "dead",
      "--type",
      "design",
      "--registered",
      "yes",
      "--sort",
      "newest-activity",
      "--offset",
      "25",
      "--data-version",
      "7",
    ],
    authenticated(() =>
      asClient({
        trademarks: {
          search: {
            query: (input: unknown) => {
              inputs.push(input);
              return Promise.resolve(searchPage);
            },
          },
        },
      })
    )
  );

  expect(inputs).toEqual([
    {
      expectedDataVersion: "7",
      limit: 25,
      match: "partial",
      mode: "multi",
      offset: 25,
      query: "Turtle %",
      registered: "yes",
      sort: "newest-activity",
      status: "dead",
      type: "design",
    },
  ]);
  expect(json(result)).toEqual({ data: searchPage, ok: true });
});

test("search maps Split and Wildcard without Multi-only match", async () => {
  const inputs: unknown[] = [];
  const createClient = () =>
    asClient({
      trademarks: {
        search: {
          query: (input: unknown) => {
            inputs.push(input);
            return Promise.resolve(searchPage);
          },
        },
      },
    });

  await runCli(["search", "turtle club", "--mode", "split"], authenticated(createClient));
  await runCli(["search", "turtle*", "--mode", "wildcard"], authenticated(createClient));

  expect(inputs).toEqual([
    {
      limit: 25,
      mode: "split",
      offset: 0,
      query: "turtle club",
      registered: "all",
      sort: "relevance",
      status: "all",
      type: "all",
    },
    {
      limit: 25,
      mode: "wildcard",
      offset: 0,
      query: "turtle*",
      registered: "all",
      sort: "relevance",
      status: "all",
      type: "all",
    },
  ]);
});

test("search rejects mode-specific flags and unsafe continuations before HTTP", async () => {
  const splitMatch = await runCli(
    ["search", "turtle", "--mode", "split", "--match", "exact"],
    dependencies()
  );
  const unsafeWildcard = await runCli(["search", "*a*b*", "--mode", "wildcard"], dependencies());
  const missingVersion = await runCli(["search", "turtle", "--offset", "25"], dependencies());

  expect(json(splitMatch).error.message).toBe("--match is valid only for Multi search");
  expect(json(unsafeWildcard).error.message).toContain("at least three consecutive");
  expect(json(missingVersion).error.message).toContain("--data-version is required");
});

test("match supports explicit text and stdin without truncation", async () => {
  const inputs: unknown[] = [];
  const createClient = () =>
    asClient({
      trademarks: {
        matchText: {
          query: (input: unknown) => {
            inputs.push(input);
            return Promise.resolve({ matches: [], meta: { dataVersion: "7" } });
          },
        },
      },
    });
  const stdin = "first turtle\nsecond turtle\n";

  await runCli(["match", "--text", "🐢 Cafe\u0301", "--type", "text"], authenticated(createClient));
  await runCli(["match", "--stdin"], authenticated(createClient, { stdin }));

  expect(inputs).toEqual([
    { text: "🐢 Cafe\u0301", type: "text" },
    { text: stdin, type: "all" },
  ]);
});

test("latest uses the fixed page size and stable continuation", async () => {
  const inputs: unknown[] = [];
  const data = { items: [], limit: 25, meta: { dataVersion: "7" }, offset: 25, total: 0 };
  const result = await runCli(
    ["latest", "--offset", "25", "--data-version", "7"],
    authenticated(() =>
      asClient({
        trademarks: {
          latest: {
            query: (input: unknown) => {
              inputs.push(input);
              return Promise.resolve(data);
            },
          },
        },
      })
    )
  );

  expect(inputs).toEqual([{ expectedDataVersion: "7", limit: 25, offset: 25 }]);
  expect(json(result)).toEqual({ data, ok: true });
});

test("reports run maps previous-week and opposition reports", async () => {
  const inputs: unknown[] = [];
  const createClient = () =>
    asClient({
      reports: {
        run: {
          query: (input: unknown) => {
            inputs.push(input);
            return Promise.resolve({});
          },
        },
      },
    });

  await runCli(
    [
      "reports",
      "run",
      "--event",
      "filed",
      "--window",
      "previous-week",
      "--offset",
      "25",
      "--data-version",
      "7",
      "--from",
      "2026-07-06",
      "--to",
      "2026-07-12",
    ],
    authenticated(createClient)
  );
  await runCli(
    ["reports", "run", "--event", "published-for-opposition"],
    authenticated(createClient)
  );

  expect(inputs).toEqual([
    {
      event: "filed",
      expectedDataVersion: "7",
      expectedFrom: "2026-07-06",
      expectedTo: "2026-07-12",
      limit: 25,
      offset: 25,
      registered: "all",
      sort: "newest-activity",
      status: "all",
      type: "all",
      window: "previous-week",
    },
    {
      event: "published-for-opposition",
      limit: 25,
      offset: 0,
      registered: "all",
      sort: "newest-activity",
      status: "all",
      type: "all",
    },
  ]);
});

test("status calls the safe authenticated service-status procedure", async () => {
  const data = {
    activeState: "idle",
    dataVersion: 0,
    failedCount: 0,
    lastSuccessfulUpdateAt: null,
    latestProcessedDate: null,
    pendingCount: 0,
  };
  const result = await runCli(
    ["status"],
    authenticated(() => asClient({ status: { query: () => Promise.resolve(data) } }))
  );

  expect(json(result)).toEqual({ data, ok: true });
});

test("typed remote errors preserve code and message on stderr", async () => {
  const notFound = Object.assign(new Error("Trademark not found"), {
    data: { code: "NOT_FOUND" },
  });
  const result = await runCli(
    ["get", "--serial", "99999999"],
    authenticated(() =>
      asClient({
        trademarks: { get: { query: () => Promise.reject(notFound) } },
      })
    )
  );

  expect(result.stdout).toBe("");
  expect(json(result)).toEqual({
    error: { code: "NOT_FOUND", details: {}, message: "Trademark not found" },
    ok: false,
  });
});

function authenticated(
  createClient: ClientFactory,
  overrides: Partial<Omit<CliDependencies, "createClient">> = {}
) {
  return dependencies({ createClient, env: { TMTURTLE_API_KEY: token }, ...overrides });
}
