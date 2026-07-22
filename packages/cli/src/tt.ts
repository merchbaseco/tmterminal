#!/usr/bin/env bun

import { createTmturtleClient } from "@tmturtle/http-client";

import packageJson from "../package.json" with { type: "json" };
import { createMacOsKeychain } from "./keychain.js";
import { readHiddenApiKey } from "./prompt.js";
import { type CliResult, failureResult, runCli } from "./run.js";

function write(output: CliResult) {
  if (output.stdout) {
    process.stdout.write(output.stdout);
  }
  if (output.stderr) {
    process.stderr.write(output.stderr);
  }
  process.exitCode = output.exitCode;
}

const args = process.argv.slice(2);
let result: CliResult;

try {
  result = await runCli(args, {
    createClient: createTmturtleClient,
    env: process.env,
    keychain: createMacOsKeychain(),
    promptSecret: readHiddenApiKey,
    stdin: args.includes("--stdin") ? await new Response(Bun.stdin.stream()).text() : "",
    version: packageJson.version,
  });
} catch {
  result = failureResult("INTERNAL_ERROR", "Command failed");
}

write(result);
