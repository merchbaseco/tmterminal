import { ServiceAccessError } from "@merchbaseco/access";

import type { TmterminalAccess } from "../src/auth/service-access.ts";

type AuthorizedAccess = Awaited<ReturnType<TmterminalAccess["interactive"]["authorize"]>>;
type EvaluatedAccess = Awaited<ReturnType<TmterminalAccess["interactive"]["evaluateAccess"]>>;

export function authorizedAccess(
  accountId: string,
  merchbaseUserId: string,
  credentialKind: AuthorizedAccess["credentialKind"]
): AuthorizedAccess {
  return {
    credentialKind,
    merchbaseUserId,
    principal: { accountId },
    service: "tmterminal",
  };
}

export function fakeTmterminalAccess(
  options: {
    interactive?: (credential: string) => Promise<AuthorizedAccess>;
    api?: (credential: string) => Promise<AuthorizedAccess>;
    refresh?: (merchbaseUserId: string) => Promise<EvaluatedAccess>;
    snapshot?: (request: Request) => Promise<Response>;
  } = {}
): TmterminalAccess {
  const unavailable = () => Promise.reject(new ServiceAccessError("unauthenticated"));
  const evaluated = (merchbaseUserId: string): EvaluatedAccess => ({
    merchbaseUserId,
    principal: { accountId: "00000000-0000-4000-8000-000000000001" },
    service: "tmterminal",
  });
  const productAccess = (
    authorize: (credential: string) => Promise<AuthorizedAccess>
  ): TmterminalAccess["interactive"] => ({
    authorize,
    evaluateAccess: async (merchbaseUserId) => evaluated(merchbaseUserId),
    refreshAccess: options.refresh ?? (async (merchbaseUserId) => evaluated(merchbaseUserId)),
  });

  return {
    api: productAccess(options.api ?? unavailable),
    development: true,
    interactive: productAccess(options.interactive ?? unavailable),
    mcp: productAccess(options.api ?? unavailable),
    snapshot: options.snapshot ?? (async () => new Response(null, { status: 204 })),
  };
}
