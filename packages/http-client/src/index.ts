import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AuthenticatedClientRouter } from "../../../apps/server/src/api/router.ts";

type InternalInputs = inferRouterInputs<AuthenticatedClientRouter>;
type InternalOutputs = inferRouterOutputs<AuthenticatedClientRouter>;

export type Account = InternalOutputs["account"]["me"];
export type ServiceStatus = InternalOutputs["sync"]["status"];
export type Trademark = InternalOutputs["marks"]["get"];
export type TrademarkGetInput = InternalInputs["marks"]["get"];
export type TrademarkListInput = InternalInputs["marks"]["list"];
export type TrademarkListPage = InternalOutputs["marks"]["list"];
export type TrademarkMatchInput = InternalInputs["marks"]["match"];
export type TrademarkMatchResult = InternalOutputs["marks"]["match"];
export type TrademarkScreenInput = InternalInputs["marks"]["screenText"];
export type TrademarkScreenResult = InternalOutputs["marks"]["screenText"];
export type TrademarkSearchInput = InternalInputs["marks"]["search"];
export type TrademarkSearchPage = InternalOutputs["marks"]["search"];

export interface TmterminalClient {
  account: {
    get: () => Promise<Account>;
  };
  status: {
    get: () => Promise<ServiceStatus>;
  };
  trademarks: {
    get: (input: TrademarkGetInput) => Promise<Trademark>;
    list: (input?: TrademarkListInput) => Promise<TrademarkListPage>;
    match: (input: TrademarkMatchInput) => Promise<TrademarkMatchResult>;
    screen: (input: TrademarkScreenInput) => Promise<TrademarkScreenResult>;
    search: (input: TrademarkSearchInput) => Promise<TrademarkSearchPage>;
  };
}

export interface TmterminalClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface TmterminalErrorOptions {
  code: string;
  details?: Record<string, unknown>;
  requestId?: string;
  status: number | null;
}

export class TmterminalError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | undefined;
  readonly status: number | null;

  constructor(message: string, options: TmterminalErrorOptions) {
    super(message);
    this.name = "TmterminalError";
    this.code = options.code;
    this.details = options.details ?? {};
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

const defaultBaseUrl = "https://tmterminal.merchbase.co";

export function createTmterminalClient({
  apiKey,
  baseUrl = defaultBaseUrl,
  fetch,
}: TmterminalClientOptions): TmterminalClient {
  const client = createTRPCClient<AuthenticatedClientRouter>({
    links: [
      httpLink({
        ...(fetch ? { fetch } : {}),
        headers: { authorization: `Bearer ${apiKey}` },
        url: new URL("/api/trpc", baseUrl).toString(),
      }),
    ],
  });
  const call = async <Result>(operation: () => Promise<Result>) => {
    try {
      return await operation();
    } catch (error) {
      throw publicError(error);
    }
  };

  return {
    account: {
      get: () => call(() => client.account.me.query()),
    },
    status: {
      get: () => call(() => client.sync.status.query()),
    },
    trademarks: {
      get: (input) => call(() => client.marks.get.query(input)),
      list: (input = {}) => call(() => client.marks.list.query(input)),
      match: (input) => call(() => client.marks.match.query(input)),
      screen: (input) => call(() => client.marks.screenText.query(input)),
      search: (input) => call(() => client.marks.search.query(input)),
    },
  };
}

function publicError(error: unknown) {
  if (error instanceof TmterminalError) {
    return error;
  }
  if (error instanceof TRPCClientError) {
    if (!error.data) {
      return new TmterminalError(error.message, {
        code: "SERVICE_UNAVAILABLE",
        status: null,
      });
    }
    const data = objectValue(error.data);
    return new TmterminalError(error.message, {
      code: stringValue(data.code) ?? "INTERNAL_ERROR",
      details: data,
      requestId: stringValue(data.requestId),
      status: numberValue(data.httpStatus),
    });
  }
  return new TmterminalError(error instanceof Error ? error.message : "Request failed", {
    code: "SERVICE_UNAVAILABLE",
    status: null,
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...value } : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
