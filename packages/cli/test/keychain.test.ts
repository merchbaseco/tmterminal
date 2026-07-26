import { expect, test } from "bun:test";

import { createMacOsKeychain, type SecurityCommand } from "../src/keychain.ts";

test("writes a Keychain token through stdin instead of process arguments", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const command: SecurityCommand = (args, stdin) => {
    calls.push({ args, stdin });
    return Promise.resolve({ exitCode: 0, stderr: "", stdout: "" });
  };
  const keychain = createMacOsKeychain(command);

  await keychain.set("https://example.com", "ttk_secret");

  expect(calls).toEqual([
    {
      args: [
        "add-generic-password",
        "-a",
        "https://example.com",
        "-s",
        "co.merchbase.tmterminal",
        "-U",
        "-w",
      ],
      stdin: "ttk_secret\n",
    },
  ]);
  expect(calls[0]?.args).not.toContain("ttk_secret");
});

test("clearing a missing Keychain credential is idempotent", async () => {
  const keychain = createMacOsKeychain(() =>
    Promise.resolve({ exitCode: 44, stderr: "not found", stdout: "" })
  );

  await expect(keychain.clear("https://example.com")).resolves.toBeUndefined();
});
