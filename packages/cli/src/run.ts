import type { TmturtleClient } from "@tmturtle/http-client";

import { BadRequestError, CliError } from "./cli-error.js";
import { parseLatest, parseMatchText, parseReport, parseSearch } from "./command-inputs.js";

const defaultOrigin = "https://tmturtle.merchbase.co";
const tokenPattern =
  /^ttk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;
const registrationNumberPattern = /^\d{7}$/;
const serialNumberPattern = /^\d{8}$/;

export interface Keychain {
  clear: (origin: string) => Promise<void>;
  get: (origin: string) => Promise<string | null>;
  set: (origin: string, token: string) => Promise<void>;
}

export type CliClient = Pick<TmturtleClient, "account" | "marks" | "reports" | "sync">;

export interface CliDependencies {
  config: { baseUrl?: string };
  createClient: (options: { apiKey: string; baseUrl: string }) => CliClient;
  env: Record<string, string | undefined>;
  keychain: Keychain;
  stdin: string;
}

export interface CliResult {
  exitCode: 0 | 1;
  stderr: string;
  stdout: string;
}

function normalizeOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new BadRequestError("Base URL must be an HTTP origin", { cause });
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BadRequestError("Base URL must be an HTTP origin");
  }
  return url.origin;
}

function success(data: unknown): CliResult {
  // biome-ignore assist/source/useSortedKeys: JSON field order is part of the CLI envelope contract.
  return { exitCode: 0, stderr: "", stdout: `${JSON.stringify({ ok: true, data })}\n` };
}

export function failureResult(code: string, message: string): CliResult {
  return {
    exitCode: 1,
    // biome-ignore assist/source/useSortedKeys: JSON field order is part of the CLI envelope contract.
    stderr: `${JSON.stringify({ ok: false, error: { code, message, details: {} } })}\n`,
    stdout: "",
  };
}

function configuredOrigin(dependencies: CliDependencies) {
  return normalizeOrigin(
    dependencies.env.TMTURTLE_BASE_URL ?? dependencies.config.baseUrl ?? defaultOrigin
  );
}

async function credential(dependencies: CliDependencies, origin: string) {
  if (dependencies.env.TMTURTLE_API_KEY !== undefined) {
    return { source: "environment" as const, token: dependencies.env.TMTURTLE_API_KEY };
  }
  const token = await dependencies.keychain.get(origin);
  if (!token) {
    throw new CliError("UNAUTHORIZED", "Authentication required");
  }
  return { source: "keychain" as const, token };
}

async function authenticatedClient(dependencies: CliDependencies) {
  const origin = configuredOrigin(dependencies);
  const selected = await credential(dependencies, origin);
  const client = dependencies.createClient({ apiKey: selected.token, baseUrl: origin });
  return { client, origin, selected };
}

function remoteFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }
  const data = "data" in error ? error.data : null;
  const code = data && typeof data === "object" && "code" in data ? data.code : null;
  return typeof code === "string" ? failureResult(code, error.message) : null;
}

async function runAuthCommand(args: string[], dependencies: CliDependencies) {
  if (args[1] === "set") {
    const withOrigin = args.length === 5 && args[2] === "--stdin" && args[3] === "--base-url";
    const withoutOrigin = args.length === 3 && args[2] === "--stdin";
    if (!(withOrigin || withoutOrigin)) {
      throw new BadRequestError("Usage: tt auth set --stdin [--base-url <origin>]");
    }
    const token = dependencies.stdin.trim();
    if (!tokenPattern.test(token)) {
      throw new BadRequestError("Invalid Trademark Turtle API key");
    }
    const [, , , , explicitOrigin] = args;
    const origin = withOrigin
      ? normalizeOrigin(explicitOrigin ?? "")
      : configuredOrigin(dependencies);
    await dependencies.keychain.set(origin, token);
    return success({ origin });
  }
  if (args.length === 2 && args[1] === "status") {
    const { client, origin, selected } = await authenticatedClient(dependencies);
    const account = await client.account.me.query();
    if (account.credential.type !== "api-key") {
      throw new CliError(
        "INTERNAL_ERROR",
        "API key validation returned an invalid credential context"
      );
    }
    // biome-ignore assist/source/useSortedKeys: JSON field order is part of the CLI envelope contract.
    return success({
      origin,
      credentialSource: selected.source,
      keySuffix: account.credential.suffix,
      accountId: account.accountId,
    });
  }
  if (args.length === 2 && args[1] === "clear") {
    const origin = configuredOrigin(dependencies);
    await dependencies.keychain.clear(origin);
    return success({ origin });
  }
  throw new BadRequestError("Unknown command");
}

async function runMarksCommand(args: string[], dependencies: CliDependencies) {
  if (args.length === 3 && args[1] === "get") {
    const [, , serialNumber] = args;
    if (!(serialNumber && serialNumberPattern.test(serialNumber))) {
      throw new BadRequestError("Serial number must be exactly 8 digits");
    }
    const { client } = await authenticatedClient(dependencies);
    return success(await client.marks.get.query({ serialNumber }));
  }
  if (args.length === 3 && args[1] === "get-by-registration") {
    const [, , registrationNumber] = args;
    if (!(registrationNumber && registrationNumberPattern.test(registrationNumber))) {
      throw new BadRequestError("Registration number must be exactly 7 digits");
    }
    const { client } = await authenticatedClient(dependencies);
    return success(await client.marks["get-by-registration"].query({ registrationNumber }));
  }
  if (args[1] === "search") {
    const input = parseSearch(args);
    const { client } = await authenticatedClient(dependencies);
    return success(await client.marks.search.query(input));
  }
  if (args[1] === "latest") {
    const input = parseLatest(args);
    const { client } = await authenticatedClient(dependencies);
    return success(await client.marks.latest.query(input));
  }
  if (args[1] === "match") {
    const input = parseMatchText(args, dependencies.stdin);
    const { client } = await authenticatedClient(dependencies);
    return success(await client.marks["match-text"].query(input));
  }
  throw new BadRequestError("Unknown command");
}

async function runReportsCommand(args: string[], dependencies: CliDependencies) {
  if (args[1] !== "run") {
    throw new BadRequestError("Unknown command");
  }
  const input = parseReport(args);
  const { client } = await authenticatedClient(dependencies);
  return success(await client.reports.run.query(input));
}

async function runSyncCommand(args: string[], dependencies: CliDependencies) {
  if (!(args.length === 2 && args[1] === "status")) {
    throw new BadRequestError("Unknown command");
  }
  const { client } = await authenticatedClient(dependencies);
  return success(await client.sync.status.query());
}

export async function runCli(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  try {
    if (args[0] === "auth") {
      return await runAuthCommand(args, dependencies);
    }
    if (args[0] === "marks") {
      return await runMarksCommand(args, dependencies);
    }
    if (args[0] === "reports") {
      return await runReportsCommand(args, dependencies);
    }
    if (args[0] === "sync") {
      return await runSyncCommand(args, dependencies);
    }

    throw new BadRequestError("Unknown command");
  } catch (error) {
    if (error instanceof CliError) {
      return failureResult(error.code, error.message);
    }
    const remote = remoteFailure(error);
    if (remote) {
      return remote;
    }
    return failureResult("INTERNAL_ERROR", "Command failed");
  }
}
