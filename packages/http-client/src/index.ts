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
export type TrademarkScreenInput = InternalInputs["marks"]["screen"];
export type TrademarkScreenResult = InternalOutputs["marks"]["screen"];
export type TrademarkSearchInput = InternalInputs["marks"]["search"];
export type TrademarkSearchPage = InternalOutputs["marks"]["search"];

export interface TmturtleClient {
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

export interface TmturtleClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface TmturtleErrorOptions {
  code: string;
  details?: Record<string, unknown>;
  requestId?: string;
  status: number | null;
}

export class TmturtleError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | undefined;
  readonly status: number | null;

  constructor(message: string, options: TmturtleErrorOptions) {
    super(message);
    this.name = "TmturtleError";
    this.code = options.code;
    this.details = options.details ?? {};
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

const defaultBaseUrl = "https://tmturtle.merchbase.co";

export function createTmturtleClient({
  apiKey,
  baseUrl = defaultBaseUrl,
  fetch,
}: TmturtleClientOptions): TmturtleClient {
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
      screen: (input) => call(() => client.marks.screen.query(input)),
      search: (input) => call(() => client.marks.search.query(input)),
    },
  };
}

function publicError(error: unknown) {
  if (error instanceof TmturtleError) {
    return error;
  }
  if (error instanceof TRPCClientError) {
    if (!error.data) {
      return new TmturtleError(error.message, {
        code: "CONNECTION_ERROR",
        status: null,
      });
    }
    const data = objectValue(error.data);
    return new TmturtleError(error.message, {
      code: stringValue(data.code) ?? "REQUEST_FAILED",
      details: data,
      requestId: stringValue(data.requestId),
      status: numberValue(data.httpStatus),
    });
  }
  return new TmturtleError(error instanceof Error ? error.message : "Request failed", {
    code: "CONNECTION_ERROR",
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
