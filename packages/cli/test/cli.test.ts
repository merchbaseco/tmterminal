import { expect, test } from "bun:test";
import type { TmturtleRouterOutputs } from "@tmturtle/http-client";

import { type CliClient, type CliDependencies, runCli } from "../src/run.ts";

const token =
  "ttk_11111111-1111-4111-8111-111111111111_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const markFixture = {
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
    contributors: [
      {
        artifactVersionSha256: "a".repeat(64),
        claimPath: "case-file/case-file-header/mark-identification",
        group: "mark-presentation",
        physicalRecordIndex: 1,
        product: "TRTYRAP",
      },
    ],
    versions: {
      authorityPolicy: "uspto-authority-v1",
      normalization: "uspto-normalization-v1",
      projection: "uspto-projection-v1",
      sourceProfile: "uspto-application-xml-v2.0-v1",
    },
  },
  statusEvents: [],
} satisfies TmturtleRouterOutputs["marks"]["get"];

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
  meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
  offset: 25,
  total: 26,
} satisfies TmturtleRouterOutputs["marks"]["search"];

const noop = () => Promise.resolve();
const noValue = () => Promise.resolve(null);
const unexpected = (name: string) => () => Promise.reject(new Error(`Unexpected ${name}`));

type DeepPartial<T> = T extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : T extends object
    ? { [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;

type DependencyOverrides = Omit<Partial<CliDependencies>, "createClient"> & {
  createClient?: (options: { apiKey: string; baseUrl: string }) => DeepPartial<CliClient>;
};

function dependencies(overrides: DependencyOverrides = {}): CliDependencies {
  return {
    config: {},
    createClient: () => {
      throw new Error("Unexpected HTTP client");
    },
    env: {},
    keychain: {
      clear: noop,
      get: noValue,
      set: noop,
    },
    stdin: "",
    ...overrides,
  } as CliDependencies;
}

test("auth set stores a stdin token against the normalized origin without echoing it", async () => {
  const stored: Array<{ origin: string; token: string }> = [];
  const result = await runCli(
    ["auth", "set", "--stdin", "--base-url", "https://EXAMPLE.com:443/"],
    dependencies({
      keychain: {
        clear: noop,
        get: noValue,
        set: (origin, value) => {
          stored.push({ origin, token: value });
          return Promise.resolve();
        },
      },
      stdin: `${token}\n`,
    })
  );

  expect(stored).toEqual([{ origin: "https://example.com", token }]);
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: '{"ok":true,"data":{"origin":"https://example.com"}}\n',
  });
  expect(result.stdout).not.toContain(token);
});

test("auth set rejects an explicitly empty base URL", async () => {
  const stored: Array<{ origin: string; token: string }> = [];
  const result = await runCli(
    ["auth", "set", "--stdin", "--base-url", ""],
    dependencies({
      config: { baseUrl: "https://configured.example" },
      keychain: {
        clear: noop,
        get: noValue,
        set: (origin, value) => {
          stored.push({ origin, token: value });
          return Promise.resolve();
        },
      },
      stdin: token,
    })
  );

  expect(stored).toEqual([]);
  expect(result).toEqual({
    exitCode: 1,
    stderr:
      '{"ok":false,"error":{"code":"BAD_REQUEST","message":"Base URL must be an HTTP origin","details":{}}}\n',
    stdout: "",
  });
});

test("auth status prefers the environment credential and validates it through account.me", async () => {
  const clients: Array<{ apiKey: string; baseUrl: string }> = [];
  let keychainReads = 0;
  const result = await runCli(
    ["auth", "status"],
    dependencies({
      config: { baseUrl: "https://config.example" },
      createClient: (options: { apiKey: string; baseUrl: string }) => {
        clients.push(options);
        return {
          account: {
            me: {
              query: () =>
                Promise.resolve({
                  accountId: "account-1",
                  credential: { keyId: "key-1", suffix: "AAAAAA", type: "api-key" },
                }),
            },
          },
          marks: {
            get: {
              query: unexpected("marks.get"),
            },
            search: {
              query: unexpected("marks.search"),
            },
          },
        };
      },
      env: {
        TMTURTLE_API_KEY: token,
        TMTURTLE_BASE_URL: "https://ENV.example/",
      },
      keychain: {
        clear: noop,
        get: () => {
          keychainReads += 1;
          return Promise.resolve("ttk_keychain");
        },
        set: noop,
      },
    })
  );

  expect(keychainReads).toBe(0);
  expect(clients).toEqual([{ apiKey: token, baseUrl: "https://env.example" }]);
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout:
      '{"ok":true,"data":{"origin":"https://env.example","credentialSource":"environment","keySuffix":"AAAAAA","accountId":"account-1"}}\n',
  });
});

test("auth status reads the Keychain entry bound to the configured origin", async () => {
  const origins: string[] = [];
  const result = await runCli(
    ["auth", "status"],
    dependencies({
      config: { baseUrl: "https://config.example/" },
      createClient: () => ({
        account: {
          me: {
            query: () =>
              Promise.resolve({
                accountId: "account-2",
                credential: { keyId: "key-2", suffix: "AAAAAA", type: "api-key" },
              }),
          },
        },
        marks: {
          get: {
            query: unexpected("marks.get"),
          },
          search: {
            query: unexpected("marks.search"),
          },
        },
      }),
      keychain: {
        clear: noop,
        get: (origin) => {
          origins.push(origin);
          return Promise.resolve(token);
        },
        set: noop,
      },
    })
  );

  expect(origins).toEqual(["https://config.example"]);
  expect(JSON.parse(result.stdout).data).toMatchObject({
    credentialSource: "keychain",
    origin: "https://config.example",
  });
});

test("an invalid selected base URL is a local validation failure", async () => {
  const result = await runCli(
    ["auth", "status"],
    dependencies({ env: { TMTURTLE_BASE_URL: "not-an-origin" } })
  );

  expect(result).toEqual({
    exitCode: 1,
    stderr:
      '{"ok":false,"error":{"code":"BAD_REQUEST","message":"Base URL must be an HTTP origin","details":{}}}\n',
    stdout: "",
  });
});

test("an invalid selected environment credential never falls back to Keychain", async () => {
  let keychainReads = 0;
  const unauthorized = Object.assign(new Error("Invalid credential"), {
    data: { code: "UNAUTHORIZED" },
  });
  const result = await runCli(
    ["auth", "status"],
    dependencies({
      createClient: () => ({
        account: {
          me: {
            query: () => Promise.reject(unauthorized),
          },
        },
        marks: {
          get: {
            query: unexpected("marks.get"),
          },
          search: {
            query: unexpected("marks.search"),
          },
        },
      }),
      env: { TMTURTLE_API_KEY: "invalid-selected-value" },
      keychain: {
        clear: noop,
        get: () => {
          keychainReads += 1;
          return Promise.resolve(token);
        },
        set: noop,
      },
    })
  );

  expect(keychainReads).toBe(0);
  expect(result).toEqual({
    exitCode: 1,
    stderr:
      '{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Invalid credential","details":{}}}\n',
    stdout: "",
  });
});

test("auth clear deletes only the entry for the selected normalized origin", async () => {
  const cleared: string[] = [];
  const result = await runCli(
    ["auth", "clear"],
    dependencies({
      config: { baseUrl: "https://CONFIG.example:443/" },
      keychain: {
        clear: (origin) => {
          cleared.push(origin);
          return Promise.resolve();
        },
        get: noValue,
        set: noop,
      },
    })
  );

  expect(cleared).toEqual(["https://config.example"]);
  expect(result.stdout).toBe('{"ok":true,"data":{"origin":"https://config.example"}}\n');
});

test("marks get writes one success envelope for an exact serial identity", async () => {
  const inputs: unknown[] = [];
  const result = await runCli(
    ["marks", "get", "60146682"],
    dependencies({
      createClient: () => ({
        account: {
          me: {
            query: unexpected("account.me"),
          },
        },
        marks: {
          get: {
            query: (input) => {
              inputs.push(input);
              return Promise.resolve(markFixture);
            },
          },
          search: {
            query: unexpected("marks.search"),
          },
        },
      }),
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(inputs).toEqual([{ serialNumber: "60146682" }]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ data: markFixture, ok: true });
});

test("marks get rejects a non-exact serial before creating an HTTP client", async () => {
  const result = await runCli(
    ["marks", "get", "6014668"],
    dependencies({
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(result).toEqual({
    exitCode: 1,
    stderr:
      '{"ok":false,"error":{"code":"BAD_REQUEST","message":"Serial number must be exactly 8 digits","details":{}}}\n',
    stdout: "",
  });
});

test("marks get preserves the stable API not-found envelope on stderr", async () => {
  const notFound = Object.assign(new Error("Trademark not found"), { data: { code: "NOT_FOUND" } });
  const result = await runCli(
    ["marks", "get", "99999999"],
    dependencies({
      createClient: () => ({
        account: {
          me: {
            query: unexpected("account.me"),
          },
        },
        marks: {
          get: {
            query: () => Promise.reject(notFound),
          },
          search: {
            query: unexpected("marks.search"),
          },
        },
      }),
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(result).toEqual({
    exitCode: 1,
    stderr:
      '{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}\n',
    stdout: "",
  });
});

test("marks search maps the approved Multi flags and preserves the server page envelope", async () => {
  const inputs: unknown[] = [];
  const result = await runCli(
    [
      "marks",
      "search",
      "Turtle %",
      "--mode",
      "multi",
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
      "--limit",
      "25",
      "--offset",
      "25",
      "--data-version",
      "7",
    ],
    dependencies({
      createClient: () => ({
        account: {
          me: {
            query: unexpected("account.me"),
          },
        },
        marks: {
          get: {
            query: unexpected("marks.get"),
          },
          search: {
            query: (input: unknown) => {
              inputs.push(input);
              return Promise.resolve(searchPage);
            },
          },
        },
      }),
      env: { TMTURTLE_API_KEY: token },
    })
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
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    // biome-ignore assist/source/useSortedKeys: This assertion protects the CLI envelope field order.
    stdout: `${JSON.stringify({ ok: true, data: searchPage })}\n`,
  });
});

test("marks search sends Split and Wildcard without Multi-only match selection", async () => {
  const inputs: unknown[] = [];
  const createClient = () => ({
    account: { me: { query: unexpected("account.me") } },
    marks: {
      get: { query: unexpected("marks.get") },
      search: {
        query: (input: unknown) => {
          inputs.push(input);
          return Promise.resolve(searchPage);
        },
      },
    },
  });

  const split = await runCli(
    ["marks", "search", "turtle club", "--mode", "split"],
    dependencies({ createClient, env: { TMTURTLE_API_KEY: token } })
  );
  const numericSplit = await runCli(
    ["marks", "search", "10000004", "--mode", "split"],
    dependencies({ createClient, env: { TMTURTLE_API_KEY: token } })
  );
  const wildcard = await runCli(
    ["marks", "search", "turtle*", "--mode", "wildcard"],
    dependencies({ createClient, env: { TMTURTLE_API_KEY: token } })
  );

  expect(split.exitCode).toBe(0);
  expect(numericSplit.exitCode).toBe(0);
  expect(wildcard.exitCode).toBe(0);
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
      mode: "split",
      offset: 0,
      query: "10000004",
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

test("marks search rejects mode-specific options and unsafe continuations before HTTP", async () => {
  const splitMatch = await runCli(
    ["marks", "search", "turtle", "--mode", "split", "--match", "exact"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );
  const wildcardMatch = await runCli(
    ["marks", "search", "turtle*", "--match", "partial", "--mode", "wildcard"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );
  const unsafeWildcard = await runCli(
    ["marks", "search", "*a*b*", "--mode", "wildcard"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );
  const normalizedUnsafeWildcard = await runCli(
    ["marks", "search", "＊＊＊", "--mode", "wildcard"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );
  const sqlMetacharactersOnly = await runCli(
    ["marks", "search", "%_\\*", "--mode", "wildcard"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );
  const punctuationSplit = await runCli(
    ["marks", "search", "—!?", "--mode", "split"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );
  const missingVersion = await runCli(
    ["marks", "search", "turtle", "--offset", "25"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );
  const retiredClassFilter = await runCli(
    ["marks", "search", "turtle", "--class", "025"],
    dependencies({ env: { TMTURTLE_API_KEY: token } })
  );

  expect(JSON.parse(splitMatch.stderr)).toMatchObject({
    error: { code: "BAD_REQUEST", message: "--match is valid only for Multi search" },
    ok: false,
  });
  expect(JSON.parse(wildcardMatch.stderr)).toMatchObject({
    error: { code: "BAD_REQUEST", message: "--match is valid only for Multi search" },
    ok: false,
  });
  expect(JSON.parse(unsafeWildcard.stderr)).toMatchObject({
    error: {
      code: "BAD_REQUEST",
      message: "Wildcard patterns must contain at least three consecutive literal word characters",
    },
    ok: false,
  });
  expect(JSON.parse(normalizedUnsafeWildcard.stderr)).toMatchObject({
    error: {
      code: "BAD_REQUEST",
      message: "Wildcard patterns must contain at least three consecutive literal word characters",
    },
    ok: false,
  });
  expect(JSON.parse(sqlMetacharactersOnly.stderr)).toMatchObject({
    error: {
      code: "BAD_REQUEST",
      message: "Wildcard patterns must contain at least three consecutive literal word characters",
    },
    ok: false,
  });
  expect(JSON.parse(punctuationSplit.stderr)).toMatchObject({
    error: { code: "BAD_REQUEST", message: "Split search requires at least one word token" },
    ok: false,
  });
  expect(JSON.parse(missingVersion.stderr)).toMatchObject({
    error: {
      code: "BAD_REQUEST",
      message: "--data-version is required when --offset is greater than 0",
    },
    ok: false,
  });
  expect(JSON.parse(retiredClassFilter.stderr)).toMatchObject({
    error: { code: "BAD_REQUEST", message: "Unknown search option --class" },
    ok: false,
  });
});

test("marks search preserves a typed data conflict envelope", async () => {
  const conflict = Object.assign(new Error("Trademark data changed during pagination"), {
    data: { code: "CONFLICT" },
  });
  const result = await runCli(
    ["marks", "search", "turtle"],
    dependencies({
      createClient: () => ({
        account: {
          me: {
            query: unexpected("account.me"),
          },
        },
        marks: {
          get: {
            query: unexpected("marks.get"),
          },
          search: {
            query: () => Promise.reject(conflict),
          },
        },
      }),
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(result).toEqual({
    exitCode: 1,
    stderr:
      '{"ok":false,"error":{"code":"CONFLICT","message":"Trademark data changed during pagination","details":{}}}\n',
    stdout: "",
  });
});

test("marks get-by-registration sends an exact registration identity", async () => {
  const inputs: unknown[] = [];
  const result = await runCli(
    ["marks", "get-by-registration", "0146682"],
    dependencies({
      createClient: () =>
        ({
          marks: {
            "get-by-registration": {
              query: (input: unknown) => {
                inputs.push(input);
                return Promise.resolve(markFixture);
              },
            },
          },
        }) as never,
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(inputs).toEqual([{ registrationNumber: "0146682" }]);
  expect(JSON.parse(result.stdout)).toEqual({ data: markFixture, ok: true });
});

test("marks match preserves listing text and the explicit type filter", async () => {
  const inputs: unknown[] = [];
  const data = {
    matches: [{ end: 13, mark: searchPage.items[0], start: 3 }],
    meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
  };
  const result = await runCli(
    ["marks", "match", "--text", "🐢 Cafe\u0301", "--type", "text"],
    dependencies({
      createClient: () =>
        ({
          marks: {
            "match-text": {
              query: (input: unknown) => {
                inputs.push(input);
                return Promise.resolve(data);
              },
            },
          },
        }) as never,
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(inputs).toEqual([{ text: "🐢 Cafe\u0301", type: "text" }]);
  expect(JSON.parse(result.stdout)).toEqual({ data, ok: true });
});

test("marks match reads stdin without silently truncating it", async () => {
  const inputs: unknown[] = [];
  const text = "first turtle\nsecond turtle\n";
  const result = await runCli(
    ["marks", "match", "--stdin"],
    dependencies({
      createClient: () =>
        ({
          marks: {
            "match-text": {
              query: (input: unknown) => {
                inputs.push(input);
                return Promise.resolve({
                  matches: [],
                  meta: { dataThroughDate: null, dataVersion: "0" },
                });
              },
            },
          },
        }) as never,
      env: { TMTURTLE_API_KEY: token },
      stdin: text,
    })
  );

  expect(result.exitCode).toBe(0);
  expect(inputs).toEqual([{ text, type: "all" }]);
});

test("marks match rejects ambiguous text sources before HTTP", async () => {
  const result = await runCli(
    ["marks", "match", "--text", "turtle", "--stdin"],
    dependencies({ env: { TMTURTLE_API_KEY: token }, stdin: "turtle" })
  );

  expect(JSON.parse(result.stderr)).toMatchObject({
    error: { code: "BAD_REQUEST", message: "--text and --stdin are mutually exclusive" },
    ok: false,
  });
});

test("marks latest preserves stable page options and the server envelope", async () => {
  const inputs: unknown[] = [];
  const data = {
    items: searchPage.items.map(({ match: _match, ...item }) => item),
    limit: 25,
    meta: searchPage.meta,
    offset: 25,
    total: 26,
  };
  const result = await runCli(
    ["marks", "latest", "--limit", "25", "--offset", "25", "--data-version", "7"],
    dependencies({
      createClient: () =>
        ({
          marks: {
            latest: {
              query: (input: unknown) => {
                inputs.push(input);
                return Promise.resolve(data);
              },
            },
          },
        }) as never,
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(inputs).toEqual([{ expectedDataVersion: "7", limit: 25, offset: 25 }]);
  expect(JSON.parse(result.stdout)).toEqual({ data, ok: true });
});

test("reports run maps a pinned previous-week continuation", async () => {
  const inputs: unknown[] = [];
  const data = {
    from: "2026-07-06",
    items: [],
    limit: 25,
    meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
    offset: 25,
    to: "2026-07-12",
    total: 26,
  };
  const result = await runCli(
    [
      "reports",
      "run",
      "--event",
      "filed",
      "--window",
      "previous-week",
      "--status",
      "live",
      "--type",
      "text",
      "--registered",
      "no",
      "--sort",
      "oldest-activity",
      "--offset",
      "25",
      "--data-version",
      "7",
      "--from",
      "2026-07-06",
      "--to",
      "2026-07-12",
    ],
    dependencies({
      createClient: () =>
        ({
          reports: {
            run: {
              query: (input: unknown) => {
                inputs.push(input);
                return Promise.resolve(data);
              },
            },
          },
        }) as never,
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(inputs).toEqual([
    {
      event: "filed",
      expectedDataVersion: "7",
      expectedFrom: "2026-07-06",
      expectedTo: "2026-07-12",
      limit: 25,
      offset: 25,
      registered: "no",
      sort: "oldest-activity",
      status: "live",
      type: "text",
      window: "previous-week",
    },
  ]);
  expect(JSON.parse(result.stdout)).toEqual({ data, ok: true });
});

test("reports run maps the current opposition-status view without a window", async () => {
  const inputs: unknown[] = [];
  const result = await runCli(
    ["reports", "run", "--event", "published-for-opposition"],
    dependencies({
      createClient: () =>
        ({
          reports: {
            run: {
              query: (input: unknown) => {
                inputs.push(input);
                return Promise.resolve({});
              },
            },
          },
        }) as never,
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(result.exitCode).toBe(0);
  expect(inputs).toEqual([
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

test("sync status preserves the authenticated freshness envelope", async () => {
  const data = {
    activeState: "idle",
    completeThroughDate: null,
    dataVersion: 0,
    degraded: false,
    degradedSince: null,
    failedCount: 0,
    lastSuccessfulUpdateAt: null,
    pendingCount: 91,
    stale: false,
    staleSince: null,
  };
  const result = await runCli(
    ["sync", "status"],
    dependencies({
      createClient: () => ({ sync: { status: { query: () => Promise.resolve(data) } } }) as never,
      env: { TMTURTLE_API_KEY: token },
    })
  );

  expect(JSON.parse(result.stdout)).toEqual({ data, ok: true });
});
