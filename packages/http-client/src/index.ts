import {
  createTRPCClient,
  httpLink,
  type CreateTRPCClient,
} from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../../../apps/server/src/api/router.ts";

export type TmturtleClient = CreateTRPCClient<AppRouter>;
export type TmturtleRouterInputs = inferRouterInputs<AppRouter>;
export type TmturtleRouterOutputs = inferRouterOutputs<AppRouter>;

type TmturtleClientOptions = {
  apiKey: string;
  baseUrl: string;
};

export function createTmturtleClient({
  apiKey,
  baseUrl,
}: TmturtleClientOptions): TmturtleClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        headers: { authorization: `Bearer ${apiKey}` },
        url: new URL("/api/trpc", baseUrl).toString(),
      }),
    ],
  });
}
