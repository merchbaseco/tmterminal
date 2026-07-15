import { expect, test } from "bun:test";

import { createMacOsKeychain, type SecurityCommand } from "../src/keychain.ts";

test("writes a Keychain token through stdin instead of process arguments", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const command: SecurityCommand = async (args, stdin) => {
    calls.push({ args, stdin });
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  const keychain = createMacOsKeychain(command);

  await keychain.set("https://example.com", "ttk_secret");

  expect(calls).toEqual([{
    args: [
      "add-generic-password",
      "-a",
      "https://example.com",
      "-s",
      "co.merchbase.tmturtle",
      "-U",
      "-w",
    ],
    stdin: "ttk_secret\n",
  }]);
  expect(calls[0]?.args).not.toContain("ttk_secret");
});
