import { expect, test } from "bun:test";
import type { TmturtleRouterOutputs } from "@tmturtle/http-client";

import { runCli, type CliDependencies } from "../src/run.ts";

const token = "ttk_11111111-1111-4111-8111-111111111111_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const tracer = {
  classes: [{ internationalCode: "009", statusCode: "6", statusDate: "2010-04-08" }],
  goodsServices: [{ text: "pistols", typeCode: "GS0091" }],
  legalDisclaimer: "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.",
  mark: {
    filingDate: "1920-09-25",
    markDrawingCode: "3",
    registrationDate: "1921-09-20",
    registrationNumber: "0146682",
    serialNumber: "60146682",
    sourceTransactionDate: "2016-03-16",
    statusCode: "626",
    statusDate: "2005-10-11",
    wordMark: "MACHINE-PISTOL",
  },
  owners: [{ entryNumber: "1", partyName: "AUTO ORDNANCE CORPORATION", partyType: "10" }],
  provenance: {
    contributors: [{
      artifactVersionSha256: "a".repeat(64),
      claimPath: "case-file/case-file-header/mark-identification",
      group: "mark-presentation",
      physicalRecordIndex: 1,
      product: "TRTYRAP",
    }],
    versions: {
      authorityPolicy: "uspto-authority-v1",
      normalization: "uspto-normalization-v1",
      projection: "uspto-projection-v1",
      sourceProfile: "uspto-application-xml-v2.0-v1",
    },
  },
  statusEvents: [],
} satisfies TmturtleRouterOutputs["marks"]["get"];

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    config: {},
    createClient: () => { throw new Error("Unexpected HTTP client"); },
    env: {},
    keychain: {
      clear: async () => {},
      get: async () => null,
      set: async () => {},
    },
    stdin: "",
    ...overrides,
  };
}

test("auth set stores a stdin token against the normalized origin without echoing it", async () => {
  const stored: Array<{ origin: string; token: string }> = [];
  const result = await runCli(
    ["auth", "set", "--stdin", "--base-url", "https://EXAMPLE.com:443/"],
    dependencies({
      stdin: `${token}\n`,
      keychain: {
        clear: async () => {},
        get: async () => null,
        set: async (origin, value) => { stored.push({ origin, token: value }); },
      },
    }),
  );

  expect(stored).toEqual([{ origin: "https://example.com", token }]);
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: '{"ok":true,"data":{"origin":"https://example.com"}}\n',
  });
  expect(result.stdout).not.toContain(token);
});

test("auth status prefers the environment credential and validates it through account.me", async () => {
  const clients: Array<{ apiKey: string; baseUrl: string }> = [];
  let keychainReads = 0;
  const result = await runCli(
    ["auth", "status"],
    dependencies({
      config: { baseUrl: "https://config.example" },
      env: {
        TMTURTLE_API_KEY: token,
        TMTURTLE_BASE_URL: "https://ENV.example/",
      },
      keychain: {
        clear: async () => {},
        get: async () => {
          keychainReads += 1;
          return "ttk_keychain";
        },
        set: async () => {},
      },
      createClient: ((options: { apiKey: string; baseUrl: string }) => {
        clients.push(options);
        return {
          account: {
            me: {
              query: async () => ({
                accountId: "account-1",
                credential: { type: "api-key", keyId: "key-1", suffix: "AAAAAA" },
              }),
            },
          },
          marks: { get: { query: async () => { throw new Error("Unexpected marks.get"); } } },
        };
      }),
    }),
  );

  expect(keychainReads).toBe(0);
  expect(clients).toEqual([{ apiKey: token, baseUrl: "https://env.example" }]);
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: '{"ok":true,"data":{"origin":"https://env.example","credentialSource":"environment","keySuffix":"AAAAAA","accountId":"account-1"}}\n',
  });
});

test("auth status reads the Keychain entry bound to the configured origin", async () => {
  const origins: string[] = [];
  const result = await runCli(
    ["auth", "status"],
    dependencies({
      config: { baseUrl: "https://config.example/" },
      keychain: {
        clear: async () => {},
        get: async (origin) => {
          origins.push(origin);
          return token;
        },
        set: async () => {},
      },
      createClient: (() => ({
        account: {
          me: {
            query: async () => ({
              accountId: "account-2",
              credential: { type: "api-key", keyId: "key-2", suffix: "AAAAAA" },
            }),
          },
        },
        marks: { get: { query: async () => { throw new Error("Unexpected marks.get"); } } },
      })),
    }),
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
    dependencies({ env: { TMTURTLE_BASE_URL: "not-an-origin" } }),
  );

  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: '{"ok":false,"error":{"code":"BAD_REQUEST","message":"Base URL must be an HTTP origin","details":{}}}\n',
  });
});

test("an invalid selected environment credential never falls back to Keychain", async () => {
  let keychainReads = 0;
  const unauthorized = Object.assign(new Error("Invalid credential"), { data: { code: "UNAUTHORIZED" } });
  const result = await runCli(
    ["auth", "status"],
    dependencies({
      env: { TMTURTLE_API_KEY: "invalid-selected-value" },
      keychain: {
        clear: async () => {},
        get: async () => {
          keychainReads += 1;
          return token;
        },
        set: async () => {},
      },
      createClient: (() => ({
        account: { me: { query: async () => { throw unauthorized; } } },
        marks: { get: { query: async () => { throw new Error("Unexpected marks.get"); } } },
      })),
    }),
  );

  expect(keychainReads).toBe(0);
  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: '{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Invalid credential","details":{}}}\n',
  });
});

test("auth clear deletes only the entry for the selected normalized origin", async () => {
  const cleared: string[] = [];
  const result = await runCli(
    ["auth", "clear"],
    dependencies({
      config: { baseUrl: "https://CONFIG.example:443/" },
      keychain: {
        clear: async (origin) => { cleared.push(origin); },
        get: async () => null,
        set: async () => {},
      },
    }),
  );

  expect(cleared).toEqual(["https://config.example"]);
  expect(result.stdout).toBe('{"ok":true,"data":{"origin":"https://config.example"}}\n');
});

test("marks get writes one success envelope for an exact serial identity", async () => {
  const inputs: unknown[] = [];
  const result = await runCli(
    ["marks", "get", "60146682"],
    dependencies({
      env: { TMTURTLE_API_KEY: token },
      createClient: (() => ({
        account: { me: { query: async () => { throw new Error("Unexpected account.me"); } } },
        marks: { get: { query: async (input) => { inputs.push(input); return tracer; } } },
      })),
    }),
  );

  expect(inputs).toEqual([{ serialNumber: "60146682" }]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ ok: true, data: tracer });
});

test("marks get rejects a non-exact serial before creating an HTTP client", async () => {
  const result = await runCli(
    ["marks", "get", "6014668"],
    dependencies({
      env: { TMTURTLE_API_KEY: token },
    }),
  );

  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: '{"ok":false,"error":{"code":"BAD_REQUEST","message":"Serial number must be exactly 8 digits","details":{}}}\n',
  });
});

test("marks get preserves the stable API not-found envelope on stderr", async () => {
  const notFound = Object.assign(new Error("Trademark not found"), { data: { code: "NOT_FOUND" } });
  const result = await runCli(
    ["marks", "get", "99999999"],
    dependencies({
      env: { TMTURTLE_API_KEY: token },
      createClient: (() => ({
        account: { me: { query: async () => { throw new Error("Unexpected account.me"); } } },
        marks: { get: { query: async () => { throw notFound; } } },
      })),
    }),
  );

  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: '{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}\n',
  });
});
