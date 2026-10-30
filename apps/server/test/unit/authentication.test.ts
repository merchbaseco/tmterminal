import { describe, expect, test } from "bun:test";
import { ServiceAccessError } from "@merchbaseco/access";
import type postgres from "postgres";

import { createAppContext } from "../../src/api/context.ts";
import { fakeTmterminalAccess } from "../fake-access.ts";

const database = {} as postgres.Sql;

describe("access boundary errors", () => {
  test("rejects missing or invalid origin assertions", async () => {
    const access = fakeTmterminalAccess();

    await expect(createAppContext({ access: access.interactive, database })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      createAppContext({
        access: access.interactive,
        assertion: "Basic ignored",
        database,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test.each([
    ["unauthenticated", "UNAUTHORIZED"],
    ["access_denied", "FORBIDDEN"],
    ["insufficient_scope", "FORBIDDEN"],
    ["access_unavailable", "SERVICE_UNAVAILABLE"],
  ] as const)("maps %s to %s", async (accessCode, trpcCode) => {
    const access = fakeTmterminalAccess({
      interactive: () => Promise.reject(new ServiceAccessError(accessCode)),
    });

    await expect(
      createAppContext({
        access: access.interactive,
        assertion: "selected",
        database,
      })
    ).rejects.toMatchObject({ code: trpcCode });
  });
});
