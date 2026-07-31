import { type TmterminalClient, TmterminalError } from "@tmterminal/http-client";

import { BadRequestError, CliError } from "./cli-error.js";
import { type CliCommand, parseCli } from "./program.js";

const defaultOrigin = "https://tmterminal.merchbase.co";
const tokenPattern = /^ak_\S+$/;
const unicodeWordTokens = /[\p{Letter}\p{Mark}\p{Number}]+/gu;

export interface Keychain {
  clear: () => Promise<void>;
  get: () => Promise<string | null>;
  set: (token: string) => Promise<void>;
}

export type CliClient = Pick<TmterminalClient, "account" | "status" | "trademarks">;

export interface CliDependencies {
  createClient: (options: { apiKey: string; baseUrl: string }) => CliClient;
  env: Record<string, string | undefined>;
  keychain: Keychain;
  promptSecret: () => Promise<string>;
  stdin: string;
  version: string;
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

function configuredOrigin(dependencies: CliDependencies, explicitOrigin?: string) {
  return normalizeOrigin(explicitOrigin ?? dependencies.env.TMTERMINAL_BASE_URL ?? defaultOrigin);
}

async function credential(dependencies: CliDependencies) {
  if (dependencies.env.MERCHBASE_API_KEY !== undefined) {
    return { source: "environment" as const, token: dependencies.env.MERCHBASE_API_KEY };
  }
  const token = await dependencies.keychain.get();
  if (!token) {
    throw new CliError("UNAUTHORIZED", "Authentication required");
  }
  return { source: "keychain" as const, token };
}

async function authenticatedClient(dependencies: CliDependencies, explicitOrigin?: string) {
  const origin = configuredOrigin(dependencies, explicitOrigin);
  const selected = await credential(dependencies);
  const client = dependencies.createClient({ apiKey: selected.token, baseUrl: origin });
  return { client, origin, selected };
}

function remoteFailure(error: unknown) {
  return error instanceof TmterminalError ? failureResult(error.code, error.message) : null;
}

function matchInput(invocation: Extract<CliCommand, { kind: "match" }>, stdin: string) {
  const text = invocation.readsStdin ? stdin : (invocation.text ?? "");
  if (text.trim().length === 0) {
    throw new BadRequestError("Match text is required");
  }
  if (text.length > 4096) {
    throw new BadRequestError("Match text must contain at most 4096 UTF-16 code units");
  }
  if ((text.match(unicodeWordTokens) ?? []).length > 128) {
    throw new BadRequestError("Match text must contain at most 128 Unicode word tokens");
  }
  return { texts: [{ id: "text", text }], type: invocation.type };
}

export async function runCli(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  try {
    const parsed = await parseCli(args, dependencies.version);
    if (parsed.kind === "text") {
      return { exitCode: 0, stderr: "", stdout: parsed.text };
    }

    const invocation = parsed.command;
    if (invocation.kind === "auth-set") {
      const origin = configuredOrigin(dependencies, parsed.baseUrl);
      const token = (
        invocation.readsStdin ? dependencies.stdin : await dependencies.promptSecret()
      ).trim();
      if (!tokenPattern.test(token)) {
        throw new BadRequestError("Invalid Merchbase API key");
      }
      await dependencies.keychain.set(token);
      return success({ origin });
    }
    if (invocation.kind === "auth-clear") {
      const origin = configuredOrigin(dependencies, parsed.baseUrl);
      await dependencies.keychain.clear();
      return success({ origin });
    }

    const authenticated = await authenticatedClient(dependencies, parsed.baseUrl);
    switch (invocation.kind) {
      case "auth-status": {
        const account = await authenticated.client.account.get();
        if (account.credential.type !== "api-key") {
          throw new CliError(
            "INTERNAL_ERROR",
            "API key validation returned an invalid credential context"
          );
        }
        // biome-ignore assist/source/useSortedKeys: JSON field order is part of the CLI envelope contract.
        return success({
          origin: authenticated.origin,
          credentialSource: authenticated.selected.source,
          accountId: account.accountId,
        });
      }
      case "get":
        return success(await authenticated.client.trademarks.get(invocation.input));
      case "list":
        return success(await authenticated.client.trademarks.list(invocation.input));
      case "match":
        return success(
          await authenticated.client.trademarks.match(matchInput(invocation, dependencies.stdin))
        );
      case "search":
        return success(await authenticated.client.trademarks.search(invocation.input));
      case "status":
        return success(await authenticated.client.status.get());
      default:
        throw new CliError("INTERNAL_ERROR", "Unsupported command");
    }
  } catch (error) {
    if (error instanceof CliError) {
      return failureResult(error.code, error.message);
    }
    const remote = remoteFailure(error);
    return remote ?? failureResult("INTERNAL_ERROR", "Command failed");
  }
}
