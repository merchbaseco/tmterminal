import { type CredentialKind, ServiceAccessError } from "@merchbaseco/access";

import type { TmterminalAccess } from "../src/auth/service-access.ts";

type AuthorizedAccess = Awaited<ReturnType<TmterminalAccess["customer"]["authorize"]>>;
type EvaluatedAccess = Awaited<ReturnType<TmterminalAccess["customer"]["evaluateAccess"]>>;

export function authorizedAccess(
  accountId: string,
  merchbaseUserId: string,
  credentialKind: CredentialKind
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
    customer?: (credential: string) => Promise<AuthorizedAccess>;
    oauth?: (credential: string) => Promise<AuthorizedAccess>;
    refresh?: (merchbaseUserId: string) => Promise<EvaluatedAccess>;
    webhook?: (request: Request) => Promise<Response>;
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
  ): TmterminalAccess["customer"] => ({
    authorize,
    evaluateAccess: async (merchbaseUserId) => evaluated(merchbaseUserId),
    refreshAccess: options.refresh ?? (async (merchbaseUserId) => evaluated(merchbaseUserId)),
  });

  return {
    customer: productAccess(options.customer ?? unavailable),
    oauth: productAccess(options.oauth ?? unavailable),
    webhook: options.webhook ?? (async () => new Response(null, { status: 204 })),
  };
}
