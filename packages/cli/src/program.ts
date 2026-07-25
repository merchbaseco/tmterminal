import type {
  TrademarkGetInput,
  TrademarkListInput,
  TrademarkSearchInput,
} from "@tmturtle/http-client";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { BadRequestError } from "./cli-error.js";

const digitsPattern = /^\d+$/;
const serialNumberPattern = /^\d{8}$/;
const registrationNumberPattern = /^\d{7}$/;
const unicodeWordCharacter = /[\p{Letter}\p{Mark}\p{Number}]/u;
const commanderErrorPrefix = /^error:\s*/u;

export type CliCommand =
  | { kind: "auth-clear" }
  | { kind: "auth-set"; readsStdin: boolean }
  | { kind: "auth-status" }
  | { input: TrademarkGetInput; kind: "get" }
  | { input: TrademarkListInput; kind: "list" }
  | { kind: "match"; readsStdin: boolean; text?: string; type: MatchOptions["type"] }
  | { input: TrademarkSearchInput; kind: "search" }
  | { kind: "status" };

export type ParsedCli =
  | { baseUrl?: string; command: CliCommand; kind: "command" }
  | { kind: "text"; text: string };

interface PageOptions {
  dataVersion?: string;
  offset: number;
}

interface SearchOptions extends PageOptions {
  match?: "both" | "exact" | "partial";
  mode: "multi" | "split" | "wildcard";
  registered: "all" | "yes" | "no";
  sort: "newest-activity" | "oldest-activity" | "relevance";
  status: "all" | "dead" | "live";
  type: "all" | "design" | "other" | "text" | "typeset";
}

interface MatchOptions {
  stdin?: boolean;
  text?: string;
  type: "all" | "design" | "other" | "text" | "typeset";
}

function nonnegativeInteger(value: string) {
  const parsed = Number(value);
  if (!(digitsPattern.test(value) && Number.isSafeInteger(parsed))) {
    throw new InvalidArgumentError("must be a nonnegative integer");
  }
  return parsed;
}

function dataVersion(value: string) {
  if (!digitsPattern.test(value)) {
    throw new InvalidArgumentError("must contain only digits");
  }
  return value;
}

function pageOptions(options: PageOptions) {
  if (options.offset > 0 && !options.dataVersion) {
    throw new BadRequestError("--data-version is required when --offset is greater than 0");
  }
  return {
    ...(options.dataVersion ? { expectedDataVersion: options.dataVersion } : {}),
    limit: 25 as const,
    offset: options.offset,
  };
}

function searchInput(query: string, options: SearchOptions): TrademarkSearchInput {
  if (query.trim().length === 0 || query.trim().length > 200) {
    throw new BadRequestError("Search query must contain between 1 and 200 characters");
  }
  if (options.mode !== "multi" && options.match) {
    throw new BadRequestError("--match is valid only for Multi search");
  }
  const normalizedQuery = query.trim().normalize("NFKC");
  if (options.mode === "split" && !unicodeWordCharacter.test(normalizedQuery)) {
    throw new BadRequestError("Split search requires at least one word token");
  }
  if (options.mode === "wildcard" && normalizedQuery.includes("*")) {
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
  const common = {
    ...pageOptions(options),
    query,
    registered: options.registered,
    sort: options.sort,
    status: options.status,
    type: options.type,
  };
  return options.mode === "multi"
    ? { ...common, match: options.match ?? "both", mode: options.mode }
    : { ...common, mode: options.mode };
}

function choices(flags: string, values: string[]) {
  return new Option(flags).choices(values);
}

function addPageOptions(command: Command) {
  return command
    .option("--offset <number>", "Result offset", nonnegativeInteger, 0)
    .option("--data-version <version>", "Expected Data Version", dataVersion);
}

function normalizeHelpArgs(args: string[]) {
  if (args.length === 0) {
    return ["--help"];
  }
  if (args[0] === "help") {
    return args.length === 1 ? ["--help"] : [...args.slice(1), "--help"];
  }
  const helpIndex = args.findIndex((arg) => arg === "-h" || arg === "--help");
  if (helpIndex >= 0) {
    return args.slice(0, helpIndex + 1);
  }
  return args.includes("--version") ? ["--version"] : args;
}

function commanderMessage(error: CommanderError) {
  return error.message.replace(commanderErrorPrefix, "");
}

export async function parseCli(args: string[], version: string): Promise<ParsedCli> {
  let command: CliCommand | undefined;
  let stdout = "";
  const program = new Command()
    .name("tt")
    .description("Search and inspect United States trademark records")
    .version(version)
    .option("--base-url <origin>", "Trademark Turtle service origin")
    .showSuggestionAfterError()
    .configureHelp({ sortOptions: true, sortSubcommands: true })
    .configureOutput({
      writeErr: () => undefined,
      writeOut: (value) => {
        stdout += value;
      },
    })
    .exitOverride()
    .addHelpText(
      "after",
      '\nExamples:\n  tt search "TURTLE CLUB" --status live\n  tt get --serial 60146682\n  printf \'%s\' "shirt title" | tt match --stdin\n'
    );

  const auth = program.command("auth").description("Manage the selected API credential");
  auth
    .command("set")
    .description("Store an API key in macOS Keychain")
    .option("--stdin", "Read the API key from stdin instead of prompting")
    .action((options: { stdin?: boolean }) => {
      command = { kind: "auth-set", readsStdin: options.stdin === true };
    });
  auth
    .command("status")
    .description("Validate and describe the selected credential")
    .action(() => {
      command = { kind: "auth-status" };
    });
  auth
    .command("clear")
    .description("Remove the stored credential for the selected origin")
    .action(() => {
      command = { kind: "auth-clear" };
    });

  addPageOptions(
    program
      .command("search")
      .description("Search word trademarks")
      .argument("<query>", "Word trademark query")
      .addOption(choices("--mode <mode>", ["multi", "split", "wildcard"]).default("multi"))
      .addOption(choices("--match <match>", ["both", "exact", "partial"]))
      .addOption(choices("--status <status>", ["all", "live", "dead"]).default("all"))
      .addOption(
        choices("--type <type>", ["all", "design", "typeset", "text", "other"]).default("all")
      )
      .addOption(choices("--registered <value>", ["all", "yes", "no"]).default("all"))
      .addOption(
        choices("--sort <sort>", ["relevance", "newest-activity", "oldest-activity"]).default(
          "relevance"
        )
      )
  ).action((query: string, options: SearchOptions) => {
    command = { input: searchInput(query, options), kind: "search" };
  });

  program
    .command("get")
    .description("Get one trademark by exact identity")
    .option("--serial <number>", "Eight-digit serial number")
    .option("--registration <number>", "Seven-digit registration number")
    .action((options: { registration?: string; serial?: string }) => {
      if (Boolean(options.serial) === Boolean(options.registration)) {
        throw new BadRequestError("Supply exactly one of --serial or --registration");
      }
      if (options.serial) {
        if (!serialNumberPattern.test(options.serial)) {
          throw new BadRequestError("Serial number must be exactly 8 digits");
        }
        command = { input: { serialNumber: options.serial }, kind: "get" };
        return;
      }
      if (!registrationNumberPattern.test(options.registration ?? "")) {
        throw new BadRequestError("Registration number must be exactly 7 digits");
      }
      command = {
        input: { registrationNumber: options.registration ?? "" },
        kind: "get",
      };
    });

  program
    .command("match")
    .description("Match listing text against live trademarks")
    .option("--text <text>", "Text to inspect")
    .option("--stdin", "Read text from stdin")
    .addOption(
      choices("--type <type>", ["all", "design", "typeset", "text", "other"]).default("all")
    )
    .action((options: MatchOptions) => {
      if (Boolean(options.text) === Boolean(options.stdin)) {
        throw new BadRequestError("Supply exactly one of --text or --stdin");
      }
      command = {
        kind: "match",
        readsStdin: options.stdin === true,
        ...(options.text ? { text: options.text } : {}),
        type: options.type,
      };
    });

  addPageOptions(program.command("list").description("List recent trademark activity")).action(
    (options: PageOptions) => {
      command = { input: pageOptions(options), kind: "list" };
    }
  );

  program
    .command("status")
    .description("Show safe service and ingestion status")
    .action(() => {
      command = { kind: "status" };
    });

  try {
    await program.parseAsync(normalizeHelpArgs(args), { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) {
        return { kind: "text", text: stdout };
      }
      throw new BadRequestError(`${commanderMessage(error)}. Run 'tt --help' for usage.`, {
        cause: error,
      });
    }
    throw error;
  }
  if (!command) {
    throw new BadRequestError("Missing command. Run 'tt --help' for usage.");
  }
  return {
    ...(program.opts<{ baseUrl?: string }>().baseUrl
      ? { baseUrl: program.opts<{ baseUrl?: string }>().baseUrl }
      : {}),
    command,
    kind: "command",
  };
}
