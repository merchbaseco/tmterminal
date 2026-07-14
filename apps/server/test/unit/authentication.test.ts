import { describe, expect, test } from "bun:test";

import { createClerkVerifier } from "../../src/auth/clerk-verifier.ts";
import { selectCredential } from "../../src/auth/select-credential.ts";

describe("credential selection", () => {
  test("selects one Clerk bearer token", () => {
    expect(
      selectCredential({
        authorization: "Bearer clerk-session",
      }),
    ).toEqual({ type: "clerk", token: "clerk-session" });
  });

  test("selects one Trademark Turtle API key", () => {
    expect(
      selectCredential({
        authorization: "Bearer ttk_123_secret",
      }),
    ).toEqual({ type: "api-key", token: "ttk_123_secret" });
  });

  test("rejects simultaneous Clerk and API-key credentials", () => {
    expect(() =>
      selectCredential({
        authorization: "Bearer ttk_123_secret",
        cookie: "__session=clerk-session",
      }),
    ).toThrow("BAD_REQUEST");
  });

  test("returns no credential when the request has none", () => {
    expect(selectCredential({})).toBeNull();
  });
});

test("Clerk verification requires an authorized-party allowlist", () => {
  expect(() => createClerkVerifier({ secretKey: "sk_test_placeholder" })).toThrow(
    "CLERK_AUTHORIZED_PARTIES is required",
  );
});
