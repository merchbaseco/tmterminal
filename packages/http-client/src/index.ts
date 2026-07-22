import { type CreateTRPCClient, createTRPCClient, httpLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AuthenticatedClientRouter } from "../../../apps/server/src/api/router.ts";

type InternalClient = CreateTRPCClient<AuthenticatedClientRouter>;
type InternalInputs = inferRouterInputs<AuthenticatedClientRouter>;
type InternalOutputs = inferRouterOutputs<AuthenticatedClientRouter>;

export interface TmturtleClient {
  account: InternalClient["account"];
  reports: InternalClient["reports"];
  status: InternalClient["sync"]["status"];
  trademarks: {
    get: InternalClient["marks"]["get"];
    getByRegistration: InternalClient["marks"]["get-by-registration"];
    latest: InternalClient["marks"]["latest"];
    matchText: InternalClient["marks"]["match-text"];
    search: InternalClient["marks"]["search"];
  };
}

export interface TmturtleRouterInputs {
  account: InternalInputs["account"];
  reports: InternalInputs["reports"];
  status: InternalInputs["sync"]["status"];
  trademarks: {
    get: InternalInputs["marks"]["get"];
    getByRegistration: InternalInputs["marks"]["get-by-registration"];
    latest: InternalInputs["marks"]["latest"];
    matchText: InternalInputs["marks"]["match-text"];
    search: InternalInputs["marks"]["search"];
  };
}

export interface TmturtleRouterOutputs {
  account: InternalOutputs["account"];
  reports: InternalOutputs["reports"];
  status: InternalOutputs["sync"]["status"];
  trademarks: {
    get: InternalOutputs["marks"]["get"];
    getByRegistration: InternalOutputs["marks"]["get-by-registration"];
    latest: InternalOutputs["marks"]["latest"];
    matchText: InternalOutputs["marks"]["match-text"];
    search: InternalOutputs["marks"]["search"];
  };
}

export interface TmturtleClientOptions {
  apiKey: string;
  baseUrl: string;
}

export function createTmturtleClient({ apiKey, baseUrl }: TmturtleClientOptions): TmturtleClient {
  const client = createTRPCClient<AuthenticatedClientRouter>({
    links: [
      httpLink({
        headers: { authorization: `Bearer ${apiKey}` },
        url: new URL("/api/trpc", baseUrl).toString(),
      }),
    ],
  });
  return {
    account: client.account,
    reports: client.reports,
    status: client.sync.status,
    trademarks: {
      get: client.marks.get,
      getByRegistration: client.marks["get-by-registration"],
      latest: client.marks.latest,
      matchText: client.marks["match-text"],
      search: client.marks.search,
    },
  };
}
