import {
  createTRPCClient,
  httpLink,
  type CreateTRPCClient,
} from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AuthenticatedClientRouter } from "../../../apps/server/src/api/router.ts";

export type TmturtleClient = CreateTRPCClient<AuthenticatedClientRouter>;
export type TmturtleRouterInputs = inferRouterInputs<AuthenticatedClientRouter>;
export type TmturtleRouterOutputs = inferRouterOutputs<AuthenticatedClientRouter>;

type TmturtleClientOptions = {
  apiKey: string;
  baseUrl: string;
};

export function createTmturtleClient({
  apiKey,
  baseUrl,
}: TmturtleClientOptions): TmturtleClient {
  return createTRPCClient<AuthenticatedClientRouter>({
    links: [
      httpLink({
        headers: { authorization: `Bearer ${apiKey}` },
        url: new URL("/api/trpc", baseUrl).toString(),
      }),
    ],
  });
}
