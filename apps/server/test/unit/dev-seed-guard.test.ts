import { describe, expect, test } from "bun:test";

import {
  assertLocalSeedTarget,
  SeedTargetRefusedError,
} from "../../src/dev-seed/local-database-guard.ts";

/**
 * The guard is the only thing standing between `bun run db:seed:dev` and the
 * live database, because the development lifecycle resolves to it by default.
 * These cases are the refusal contract, not incidental coverage.
 */

const notLoopback = /is not loopback/;
const nodeEnvProduction = /NODE_ENV is production/;
const unparseable = /not a parseable URL/;
const namedTarget = /db\.internal:5432\/tmturtle/;

describe("assertLocalSeedTarget", () => {
  test("accepts loopback hosts", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      expect(
        assertLocalSeedTarget({
          databaseUrl: `postgres://tmturtle:secret@${host}:5437/tmturtle`,
        }).port
      ).toBe("5437");
    }
  });

  test("refuses the development database reached over Tailscale", () => {
    expect(() =>
      assertLocalSeedTarget({
        databaseUrl: "postgres://tmturtle:secret@zachs-mac-mini.taila0b849.ts.net:5437/tmturtle",
      })
    ).toThrow(notLoopback);
  });

  test("refuses the production container-network host", () => {
    expect(() =>
      assertLocalSeedTarget({ databaseUrl: "postgres://tmturtle:secret@database:5432/tmturtle" })
    ).toThrow(SeedTargetRefusedError);
  });

  test("refuses a loopback host when NODE_ENV is production", () => {
    expect(() =>
      assertLocalSeedTarget({
        databaseUrl: "postgres://tmturtle:secret@127.0.0.1:5437/tmturtle",
        nodeEnv: "production",
      })
    ).toThrow(nodeEnvProduction);
  });

  test("refuses an unparseable url without leaking it", () => {
    expect(() => assertLocalSeedTarget({ databaseUrl: "tmturtle" })).toThrow(unparseable);
  });

  test("names the refused target so the message is actionable", () => {
    expect(() =>
      assertLocalSeedTarget({ databaseUrl: "postgres://tmturtle:secret@db.internal:5432/tmturtle" })
    ).toThrow(namedTarget);
  });

  test("never repeats the credential back in the refusal", () => {
    const refusal = (() => {
      try {
        assertLocalSeedTarget({
          databaseUrl: "postgres://tmturtle:hunter2@db.internal:5432/tmturtle",
        });
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : "";
      }
    })();

    expect(refusal).not.toContain("hunter2");
  });
});
