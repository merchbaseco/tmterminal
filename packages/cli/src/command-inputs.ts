import type { TmturtleRouterInputs } from "@tmturtle/http-client";

import { BadRequestError } from "./cli-error.js";

const digitsPattern = /^\d+$/;
const unicodeWordCharacter = /[\p{Letter}\p{Mark}\p{Number}]/u;

type SearchInput = TmturtleRouterInputs["marks"]["search"];
type MultiSearchInput = Extract<SearchInput, { mode: "multi" }>;
type SearchOptions = Omit<MultiSearchInput, "limit" | "match" | "mode" | "query"> & {
  match?: MultiSearchInput["match"];
  mode: SearchInput["mode"];
};
type LatestInput = TmturtleRouterInputs["marks"]["latest"] & { limit: 25; offset: number };
type ReportInput = TmturtleRouterInputs["reports"]["run"];
type ReportEvent = ReportInput["event"];

interface ReportOptions {
  event?: ReportEvent;
  expectedDataVersion?: string;
  expectedFrom?: string;
  expectedTo?: string;
  offset: number;
  registered: "all" | "yes" | "no";
  sort: "newest-activity" | "oldest-activity";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "typeset" | "text" | "other";
  window?: string;
}

function optionValue<const Value extends string>(
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
      options.mode = optionValue(flag, value, ["multi", "split", "wildcard"]);
      return;
    case "--match":
      options.match = optionValue(flag, value, ["both", "exact", "partial"]);
      return;
    case "--status":
      options.status = optionValue(flag, value, ["live", "dead"]);
      return;
    case "--type":
      options.type = optionValue(flag, value, ["design", "typeset", "text", "other"]);
      return;
    case "--registered":
      options.registered = optionValue(flag, value, ["yes", "no"]);
      return;
    case "--sort":
      options.sort = optionValue(flag, value, ["relevance", "newest-activity", "oldest-activity"]);
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

export function parseSearch(args: string[]): SearchInput {
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
  return mode === "multi"
    ? { ...common, limit: 25, match: match ?? "both", mode, query }
    : { ...common, limit: 25, mode, query };
}

function applyPageOption(options: LatestInput, flag: string, value: string) {
  if (flag === "--limit") {
    if (value !== "25") {
      throw new BadRequestError("--limit must be 25");
    }
  } else if (flag === "--offset") {
    const parsed = Number(value);
    if (!(digitsPattern.test(value) && Number.isSafeInteger(parsed))) {
      throw new BadRequestError("--offset must be a nonnegative integer");
    }
    options.offset = parsed;
  } else if (flag === "--data-version") {
    if (!digitsPattern.test(value)) {
      throw new BadRequestError("--data-version must contain only digits");
    }
    options.expectedDataVersion = value;
  } else {
    throw new BadRequestError(`Unknown page option ${flag}`);
  }
}

export function parseLatest(args: string[]): LatestInput {
  const input: LatestInput = { limit: 25, offset: 0 };
  const seen = new Set<string>();
  for (let index = 2; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new BadRequestError(`Missing value for ${flag}`);
    }
    if (seen.has(flag)) {
      throw new BadRequestError(`Duplicate option ${flag}`);
    }
    seen.add(flag);
    applyPageOption(input, flag, value);
  }
  if (input.offset > 0 && !input.expectedDataVersion) {
    throw new BadRequestError("--data-version is required when --offset is greater than 0");
  }
  return input;
}

export function parseMatchText(
  args: string[],
  stdin: string
): TmturtleRouterInputs["marks"]["match-text"] {
  let text: string | undefined;
  let readsStdin = false;
  let type: "all" | "design" | "typeset" | "text" | "other" = "all";
  const seen = new Set<string>();
  for (let index = 2; index < args.length; ) {
    const flag = args[index];
    if (!flag?.startsWith("--")) {
      throw new BadRequestError("Unknown marks match option");
    }
    if (seen.has(flag)) {
      throw new BadRequestError(`Duplicate option ${flag}`);
    }
    seen.add(flag);
    if (flag === "--stdin") {
      readsStdin = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new BadRequestError(`Missing value for ${flag}`);
    }
    if (flag === "--text") {
      text = value;
    } else if (flag === "--type") {
      type = optionValue(flag, value, ["design", "typeset", "text", "other"]);
    } else {
      throw new BadRequestError(`Unknown marks match option ${flag}`);
    }
    index += 2;
  }
  if (text !== undefined && readsStdin) {
    throw new BadRequestError("--text and --stdin are mutually exclusive");
  }
  const selectedText = readsStdin ? stdin : text;
  if (selectedText === undefined || selectedText.trim().length === 0) {
    throw new BadRequestError("Usage: tt marks match (--text <text> | --stdin) [--type <type>]");
  }
  return { text: selectedText, type };
}

function applyReportOption(options: ReportOptions, flag: string, value: string) {
  switch (flag) {
    case "--event":
      options.event = optionValue(flag, value, ["filed", "registered", "published-for-opposition"]);
      break;
    case "--window":
      options.window = value;
      break;
    case "--status":
      options.status = optionValue(flag, value, ["live", "dead"]);
      break;
    case "--type":
      options.type = optionValue(flag, value, ["design", "typeset", "text", "other"]);
      break;
    case "--registered":
      options.registered = optionValue(flag, value, ["yes", "no"]);
      break;
    case "--sort":
      options.sort = optionValue(flag, value, ["newest-activity", "oldest-activity"]);
      break;
    case "--limit":
      if (value !== "25") {
        throw new BadRequestError("--limit must be 25");
      }
      break;
    case "--offset": {
      const parsed = Number(value);
      if (!(digitsPattern.test(value) && Number.isSafeInteger(parsed))) {
        throw new BadRequestError("--offset must be a nonnegative integer");
      }
      options.offset = parsed;
      break;
    }
    case "--data-version":
      if (!digitsPattern.test(value)) {
        throw new BadRequestError("--data-version must contain only digits");
      }
      options.expectedDataVersion = value;
      break;
    case "--from":
      options.expectedFrom = value;
      break;
    case "--to":
      options.expectedTo = value;
      break;
    default:
      throw new BadRequestError(`Unknown report option ${flag}`);
  }
}

function parseReportOptions(args: string[]) {
  const options: ReportOptions = {
    offset: 0,
    registered: "all",
    sort: "newest-activity",
    status: "all",
    type: "all",
  };
  const seen = new Set<string>();
  for (let index = 2; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new BadRequestError(`Missing value for ${flag}`);
    }
    if (seen.has(flag)) {
      throw new BadRequestError(`Duplicate option ${flag}`);
    }
    seen.add(flag);
    applyReportOption(options, flag, value);
  }
  return options;
}

export function parseReport(args: string[]): ReportInput {
  const options = parseReportOptions(args);
  const { event, expectedDataVersion, expectedFrom, expectedTo, offset, window } = options;
  if (!event) {
    throw new BadRequestError("--event is required");
  }
  if (offset > 0 && !expectedDataVersion) {
    throw new BadRequestError("--data-version is required when --offset is greater than 0");
  }
  const common = {
    ...(expectedDataVersion ? { expectedDataVersion } : {}),
    limit: 25 as const,
    offset,
    registered: options.registered,
    sort: options.sort,
    status: options.status,
    type: options.type,
  };
  if (event === "published-for-opposition") {
    if (window || expectedFrom || expectedTo) {
      throw new BadRequestError("Published-for-opposition reports do not use a window");
    }
    return { ...common, event };
  }
  if (window !== "previous-week") {
    throw new BadRequestError("Filed and registered reports require --window previous-week");
  }
  const hasCompleteWindow = Boolean(expectedFrom && expectedTo);
  if (
    Boolean(expectedFrom || expectedTo) !== hasCompleteWindow ||
    Boolean(expectedDataVersion) !== hasCompleteWindow
  ) {
    throw new BadRequestError("--data-version, --from, and --to must be supplied together");
  }
  return {
    ...common,
    ...(expectedFrom && expectedTo ? { expectedFrom, expectedTo } : {}),
    event,
    window: "previous-week",
  };
}
