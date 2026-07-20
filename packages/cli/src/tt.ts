#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createTmturtleClient } from "@tmturtle/http-client";

import { createMacOsKeychain } from "./keychain.js";
import { type CliResult, failureResult, runCli } from "./run.js";

class ConfigError extends Error {}

async function loadConfig() {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(homedir(), ".tmturtle", "config.json"), "utf8")
    );
    if (!parsed || typeof parsed !== "object") {
      throw new ConfigError("Invalid ~/.tmturtle/config.json");
    }
    const baseUrl = "baseUrl" in parsed ? parsed.baseUrl : undefined;
    if (baseUrl !== undefined && typeof baseUrl !== "string") {
      throw new ConfigError("Invalid ~/.tmturtle/config.json baseUrl");
    }
    return { baseUrl };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError("Invalid ~/.tmturtle/config.json", { cause: error });
  }
}

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
  const readsStdin =
    (args[0] === "auth" && args[1] === "set" && args.includes("--stdin")) ||
    (args[0] === "marks" && args[1] === "match" && args.includes("--stdin"));
  result = await runCli(args, {
    config: await loadConfig(),
    createClient: createTmturtleClient,
    env: process.env,
    keychain: createMacOsKeychain(),
    stdin: readsStdin ? await new Response(Bun.stdin.stream()).text() : "",
  });
} catch (error) {
  result =
    error instanceof ConfigError
      ? failureResult("BAD_REQUEST", error.message)
      : failureResult("INTERNAL_ERROR", "Command failed");
}

write(result);
