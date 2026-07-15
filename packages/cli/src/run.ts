import type { TmturtleRouterInputs, TmturtleRouterOutputs } from "@tmturtle/http-client";

const defaultOrigin = "https://tmturtle.merchbase.co";
const tokenPattern = /^ttk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;

export type Keychain = {
  clear(origin: string): Promise<void>;
  get(origin: string): Promise<string | null>;
  set(origin: string, token: string): Promise<void>;
};

export type CliClient = {
  account: {
    me: { query(): Promise<TmturtleRouterOutputs["account"]["me"]> };
  };
  marks: {
    get: {
      query(input: TmturtleRouterInputs["marks"]["get"]): Promise<TmturtleRouterOutputs["marks"]["get"]>;
    };
    search: {
      query(input: TmturtleRouterInputs["marks"]["search"]): Promise<TmturtleRouterOutputs["marks"]["search"]>;
    };
  };
};

export type CliDependencies = {
  config: { baseUrl?: string };
  createClient(options: { apiKey: string; baseUrl: string }): CliClient;
  env: Record<string, string | undefined>;
  keychain: Keychain;
  stdin: string;
};

export type CliResult = {
  exitCode: 0 | 1;
  stderr: string;
  stdout: string;
};

class CliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

class BadRequestError extends CliError {
  constructor(message: string) {
    super("BAD_REQUEST", message);
  }
}

function normalizeOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestError("Base URL must be an HTTP origin");
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
  return { exitCode: 0, stderr: "", stdout: `${JSON.stringify({ ok: true, data })}\n` };
}

export function failureResult(code: string, message: string): CliResult {
  return {
    exitCode: 1,
    stderr: `${JSON.stringify({ ok: false, error: { code, message, details: {} } })}\n`,
    stdout: "",
  };
}

function configuredOrigin(dependencies: CliDependencies) {
  return normalizeOrigin(
    dependencies.env.TMTURTLE_BASE_URL ?? dependencies.config.baseUrl ?? defaultOrigin,
  );
}

async function credential(dependencies: CliDependencies, origin: string) {
  if (dependencies.env.TMTURTLE_API_KEY !== undefined) {
    return { source: "environment" as const, token: dependencies.env.TMTURTLE_API_KEY };
  }
  const token = await dependencies.keychain.get(origin);
  if (!token) throw new CliError("UNAUTHORIZED", "Authentication required");
  return { source: "keychain" as const, token };
}

function remoteFailure(error: unknown) {
  if (!(error instanceof Error)) return null;
  const data = "data" in error ? error.data : null;
  const code = data && typeof data === "object" && "code" in data ? data.code : null;
  return typeof code === "string" ? failureResult(code, error.message) : null;
}

function parseMultiSearch(args: string[]): TmturtleRouterInputs["marks"]["search"] {
  const query = args[2];
  if (!query || query.startsWith("--") || query.trim().length === 0 || query.trim().length > 200) {
    throw new BadRequestError("Usage: tt marks search <query> [options]");
  }

  const classes: string[] = [];
  const seen = new Set<string>();
  let expectedCorpusVersion: string | undefined;
  let match: "both" | "exact" | "partial" = "both";
  let offset = 0;
  let registered: "all" | "yes" | "no" = "all";
  let sort: "relevance" | "newest-activity" | "oldest-activity" = "relevance";
  let status: "all" | "live" | "dead" = "all";
  let type: "all" | "design" | "typeset" | "text" | "other" = "all";

  for (let index = 3; index < args.length; index += 2) {
    const flag = args[index]!;
    const value = args[index + 1];
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new BadRequestError(`Missing value for ${flag}`);
    }
    if (flag !== "--class" && seen.has(flag)) throw new BadRequestError(`Duplicate option ${flag}`);
    seen.add(flag);

    switch (flag) {
      case "--mode":
        if (value !== "multi") throw new BadRequestError("Only Multi search is available");
        break;
      case "--match":
        if (value !== "both" && value !== "exact" && value !== "partial") {
          throw new BadRequestError("--match must be both, exact, or partial");
        }
        match = value;
        break;
      case "--status":
        if (value !== "live" && value !== "dead") {
          throw new BadRequestError("--status must be live or dead");
        }
        status = value;
        break;
      case "--class":
        if (!/^(?:\d{3}|[AB])$/.test(value)) {
          throw new BadRequestError("--class must be a three-digit International Class, A, or B");
        }
        classes.push(value);
        if (classes.length > 45) throw new BadRequestError("At most 45 --class options are allowed");
        break;
      case "--type":
        if (value !== "design" && value !== "typeset" && value !== "text" && value !== "other") {
          throw new BadRequestError("--type must be design, typeset, text, or other");
        }
        type = value;
        break;
      case "--registered":
        if (value !== "yes" && value !== "no") {
          throw new BadRequestError("--registered must be yes or no");
        }
        registered = value;
        break;
      case "--sort":
        if (value !== "relevance" && value !== "newest-activity" && value !== "oldest-activity") {
          throw new BadRequestError("--sort must be relevance, newest-activity, or oldest-activity");
        }
        sort = value;
        break;
      case "--limit":
        if (value !== "25") throw new BadRequestError("--limit must be 25");
        break;
      case "--offset": {
        const parsed = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
          throw new BadRequestError("--offset must be a nonnegative integer");
        }
        offset = parsed;
        break;
      }
      case "--corpus-version":
        if (!/^\d+$/.test(value)) throw new BadRequestError("--corpus-version must contain only digits");
        expectedCorpusVersion = value;
        break;
      default:
        throw new BadRequestError(`Unknown search option ${flag}`);
    }
  }

  if (offset > 0 && !expectedCorpusVersion) {
    throw new BadRequestError("--corpus-version is required when --offset is greater than 0");
  }

  return {
    classes,
    ...(expectedCorpusVersion ? { expectedCorpusVersion } : {}),
    limit: 25,
    match,
    mode: "multi",
    offset,
    query,
    registered,
    sort,
    status,
    type,
  };
}

export async function runCli(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  try {
    if (args[0] === "auth" && args[1] === "set") {
      const withOrigin = args.length === 5 && args[2] === "--stdin" && args[3] === "--base-url";
      const withoutOrigin = args.length === 3 && args[2] === "--stdin";
      if (!withOrigin && !withoutOrigin) throw new BadRequestError("Usage: tt auth set --stdin [--base-url <origin>]");

      const token = dependencies.stdin.trim();
      if (!tokenPattern.test(token)) throw new BadRequestError("Invalid Trademark Turtle API key");
      const origin = withOrigin ? normalizeOrigin(args[4]!) : configuredOrigin(dependencies);
      await dependencies.keychain.set(origin, token);
      return success({ origin });
    }

    if (args.length === 2 && args[0] === "auth" && args[1] === "status") {
      const origin = configuredOrigin(dependencies);
      const selected = await credential(dependencies, origin);
      const account = await dependencies.createClient({ apiKey: selected.token, baseUrl: origin }).account.me.query();
      if (account.credential.type !== "api-key") {
        throw new CliError("INTERNAL_ERROR", "API key validation returned an invalid credential context");
      }
      return success({
        origin,
        credentialSource: selected.source,
        keySuffix: account.credential.suffix,
        accountId: account.accountId,
      });
    }

    if (args.length === 2 && args[0] === "auth" && args[1] === "clear") {
      const origin = configuredOrigin(dependencies);
      await dependencies.keychain.clear(origin);
      return success({ origin });
    }

    if (args.length === 3 && args[0] === "marks" && args[1] === "get") {
      const serialNumber = args[2]!;
      if (!/^\d{8}$/.test(serialNumber)) {
        throw new BadRequestError("Serial number must be exactly 8 digits");
      }
      const origin = configuredOrigin(dependencies);
      const selected = await credential(dependencies, origin);
      const mark = await dependencies
        .createClient({ apiKey: selected.token, baseUrl: origin })
        .marks.get.query({ serialNumber });
      return success(mark);
    }

    if (args[0] === "marks" && args[1] === "search") {
      const input = parseMultiSearch(args);
      const origin = configuredOrigin(dependencies);
      const selected = await credential(dependencies, origin);
      const page = await dependencies
        .createClient({ apiKey: selected.token, baseUrl: origin })
        .marks.search.query(input);
      return success(page);
    }

    throw new BadRequestError("Unknown command");
  } catch (error) {
    if (error instanceof CliError) return failureResult(error.code, error.message);
    const remote = remoteFailure(error);
    if (remote) return remote;
    return failureResult("INTERNAL_ERROR", "Command failed");
  }
}
