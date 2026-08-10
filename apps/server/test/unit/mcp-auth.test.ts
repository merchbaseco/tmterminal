import { describe, expect, it, mock } from "bun:test";
import { ServiceAccessError } from "@merchbaseco/access";

import { authenticateMcpRequest } from "../../src/mcp/auth.ts";

describe("Trademark Terminal MCP authentication", () => {
  it("requires an OAuth bearer token and rejects API keys", async () => {
    const authorize = mock(async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" }));

    await expect(authenticateMcpRequest(undefined, { authorize })).resolves.toEqual({
      status: "unauthorized",
    });
    await expect(authenticateMcpRequest("Bearer ak_test", { authorize })).resolves.toEqual({
      status: "unauthorized",
    });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("returns stable auth information for an authorized caller", async () => {
    const result = await authenticateMcpRequest("Bearer oauth-token", {
      authorize: async () => ({ accountId: "account-1", merchbaseUserId: "mbu-1" }),
    });

    expect(result).toMatchObject({
      accountId: "account-1",
      authInfo: {
        extra: { merchbaseUserId: "mbu-1" },
        scopes: ["openid", "email", "profile"],
        token: "oauth-token",
      },
      status: "authenticated",
    });
  });

  it("maps Access failures without exposing backend details", async () => {
    const failure = (code: ConstructorParameters<typeof ServiceAccessError>[0]) => ({
      authorize: mock(() => Promise.reject(new ServiceAccessError(code))),
    });

    await expect(authenticateMcpRequest("Bearer token", failure("access_denied"))).resolves.toEqual(
      { missingScopes: [], status: "forbidden" }
    );
    await expect(
      authenticateMcpRequest("Bearer token", failure("access_unavailable"))
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      authenticateMcpRequest("Bearer token", failure("unauthenticated"))
    ).resolves.toEqual({ status: "unauthorized" });
  });
});
