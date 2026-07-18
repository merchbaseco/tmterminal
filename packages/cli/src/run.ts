import type { TmturtleRouterInputs, TmturtleRouterOutputs } from "@tmturtle/http-client";

const defaultOrigin = "https://tmturtle.merchbase.co";
const tokenPattern =
  /^ttk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;
const digitsPattern = /^\d+$/;
const serialNumberPattern = /^\d{8}$/;
const unicodeWordCharacter = /[\p{Letter}\p{Mark}\p{Number}]/u;

export interface Keychain {
  clear: (origin: string) => Promise<void>;
  get: (origin: string) => Promise<string | null>;
  set: (origin: string, token: string) => Promise<void>;
}

export interface CliClient {
  account: {
    me: { query: () => Promise<TmturtleRouterOutputs["account"]["me"]> };
  };
  marks: {
    get: {
      query: (
        input: TmturtleRouterInputs["marks"]["get"]
      ) => Promise<TmturtleRouterOutputs["marks"]["get"]>;
    };
    search: {
      query: (
        input: TmturtleRouterInputs["marks"]["search"]
      ) => Promise<TmturtleRouterOutputs["marks"]["search"]>;
    };
  };
}

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

class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

class BadRequestError extends CliError {
  constructor(message: string, options?: ErrorOptions) {
    super("BAD_REQUEST", message, options);
  }
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

function remoteFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }
  const data = "data" in error ? error.data : null;
  const code = data && typeof data === "object" && "code" in data ? data.code : null;
  return typeof code === "string" ? failureResult(code, error.message) : null;
}

type SearchInput = TmturtleRouterInputs["marks"]["search"];
type MultiSearchInput = Extract<SearchInput, { mode: "multi" }>;
type SearchOptions = Omit<MultiSearchInput, "limit" | "match" | "mode" | "query"> & {
  match?: MultiSearchInput["match"];
  mode: SearchInput["mode"];
};

function searchOptionValue<const Value extends string>(
  flag: string,
  value: string,
  values: readonly Value[]
): Value {
  if (!values.includes(value as Value)) {
    throw new BadRequestError(`${flag} must be ${values.join(", ")}`);
  }
  return value as Value;
}

function applySearchOption(options: SearchOptions, flag: string, value: string) {
  switch (flag) {
    case "--mode":
      options.mode = searchOptionValue(flag, value, ["multi", "split", "wildcard"]);
      return;
    case "--match":
      options.match = searchOptionValue(flag, value, ["both", "exact", "partial"]);
      return;
    case "--status":
      options.status = searchOptionValue(flag, value, ["live", "dead"]);
      return;
    case "--type":
      options.type = searchOptionValue(flag, value, ["design", "typeset", "text", "other"]);
      return;
    case "--registered":
      options.registered = searchOptionValue(flag, value, ["yes", "no"]);
      return;
    case "--sort":
      options.sort = searchOptionValue(flag, value, [
        "relevance",
        "newest-activity",
        "oldest-activity",
      ]);
      return;
    case "--limit":
      if (value !== "25") {
        throw new BadRequestError("--limit must be 25");
      }
      return;
    case "--offset": {
      const parsed = Number(value);
      if (!(digitsPattern.test(value) && Number.isSafeInteger(parsed))) {
        throw new BadRequestError("--offset must be a nonnegative integer");
      }
      options.offset = parsed;
      return;
    }
    case "--data-version":
      if (!digitsPattern.test(value)) {
        throw new BadRequestError("--data-version must contain only digits");
      }
      options.expectedDataVersion = value;
      return;
    default:
      throw new BadRequestError(`Unknown search option ${flag}`);
  }
}

function validateSearchOptions(query: string, options: SearchOptions) {
  if ((options.offset ?? 0) > 0 && !options.expectedDataVersion) {
    throw new BadRequestError("--data-version is required when --offset is greater than 0");
  }
  if (options.mode !== "multi" && options.match) {
    throw new BadRequestError("--match is valid only for Multi search");
  }
  const normalizedQuery = query.trim().normalize("NFKC");
  if (options.mode === "split" && !unicodeWordCharacter.test(normalizedQuery)) {
    throw new BadRequestError("Split search requires at least one word token");
  }
  if (options.mode !== "wildcard" || !normalizedQuery.includes("*")) {
    return;
  }
  const longestLiteralWordRun = normalizedQuery
    .split("*")
    .flatMap((part) => part.match(/[\p{Letter}\p{Mark}\p{Number}]+/gu) ?? [])
    .reduce((longest, part) => Math.max(longest, Array.from(part).length), 0);
  if (longestLiteralWordRun < 3) {
    throw new BadRequestError(
      "Wildcard patterns must contain at least three consecutive literal word characters"
    );
  }
}

function parseSearch(args: string[]): SearchInput {
  const [, , query] = args;
  if (!query || query.startsWith("--") || query.trim().length === 0 || query.trim().length > 200) {
    throw new BadRequestError("Usage: tt marks search <query> [options]");
  }

  const seen = new Set<string>();
  const options: SearchOptions = {
    mode: "multi",
    offset: 0,
    registered: "all",
    sort: "relevance",
    status: "all",
    type: "all",
  };

  for (let index = 3; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new BadRequestError(`Missing value for ${flag}`);
    }
    if (seen.has(flag)) {
      throw new BadRequestError(`Duplicate option ${flag}`);
    }
    seen.add(flag);
    applySearchOption(options, flag, value);
  }

  validateSearchOptions(query, options);

  const { match, mode, ...common } = options;
  if (mode === "multi") {
    return { ...common, limit: 25, match: match ?? "both", mode, query };
  }

  return {
    ...common,
    limit: 25,
    mode,
    query,
  };
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
    const origin = configuredOrigin(dependencies);
    const selected = await credential(dependencies, origin);
    const account = await dependencies
      .createClient({ apiKey: selected.token, baseUrl: origin })
      .account.me.query();
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
    const origin = configuredOrigin(dependencies);
    const selected = await credential(dependencies, origin);
    const client = dependencies.createClient({ apiKey: selected.token, baseUrl: origin });
    return success(await client.marks.get.query({ serialNumber }));
  }
  if (args[1] === "search") {
    const input = parseSearch(args);
    const origin = configuredOrigin(dependencies);
    const selected = await credential(dependencies, origin);
    const client = dependencies.createClient({ apiKey: selected.token, baseUrl: origin });
    return success(await client.marks.search.query(input));
  }
  throw new BadRequestError("Unknown command");
}

export async function runCli(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  try {
    if (args[0] === "auth") {
      return await runAuthCommand(args, dependencies);
    }
    if (args[0] === "marks") {
      return await runMarksCommand(args, dependencies);
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
