import {
  createAccessSnapshotClient,
  createCloudflareAssertionVerifier,
  createCloudflareProjectionHandler,
  createCloudflareServiceAccess,
  type MerchbaseService,
  ServiceAccessError,
} from "@merchbaseco/access";
import { createDevCloudflareAccess, DEV_ACCESS_AUTHORITY_ORIGIN } from "@merchbaseco/access/dev";
import type postgres from "postgres";
import { createAccessProjectionStore } from "../queries/access-projection-store.ts";
import { resolveMerchbaseAccount } from "../queries/account-repository.ts";

export interface AccessPrincipal {
  accountId: string;
}
interface AuthorizedAccess {
  credentialKind: "api_key" | "oauth" | "session";
  merchbaseUserId: string;
  principal: AccessPrincipal;
  service: MerchbaseService;
}
interface ProductAccess {
  authorize: (assertion: string) => Promise<AuthorizedAccess>;
  evaluateAccess: (uid: string) => Promise<Omit<AuthorizedAccess, "credentialKind">>;
  refreshAccess: (uid: string) => Promise<Omit<AuthorizedAccess, "credentialKind">>;
}
export interface TmterminalAccess {
  api: ProductAccess;
  development: boolean;
  interactive: ProductAccess;
  mcp: ProductAccess;
  snapshot: (request: Request) => Promise<Response>;
}

export const createConfiguredTmterminalAccess = async (
  database: postgres.Sql,
  databaseUrl: string
): Promise<TmterminalAccess> => {
  const authorityOrigin =
    process.env.NODE_ENV === "development"
      ? DEV_ACCESS_AUTHORITY_ORIGIN
      : requiredEnvironment("MERCHBASE_ACCESS_AUTHORITY_ORIGIN");
  const projections = createAccessProjectionStore(database, authorityOrigin);
  const resolveServicePrincipal = async ({ merchbaseUserId }: { merchbaseUserId: string }) => ({
    accountId: await resolveMerchbaseAccount(database, merchbaseUserId),
  });
  if (process.env.NODE_ENV === "development") {
    const access = await createDevCloudflareAccess({
      databaseUrl,
      projections,
      resolveServicePrincipal,
      service: "tmterminal",
    });
    const interactive = adapt(access, "session");
    return {
      api: adapt(access, "oauth"),
      development: true,
      interactive,
      mcp: adapt(access, "oauth"),
      snapshot: async () => new Response(null, { status: 404 }),
    };
  }
  const issuer = requiredEnvironment("MERCHBASE_ACCESS_ISSUER");
  const common = {
    authorityOrigin,
    issuer,
    loadSnapshot: createAccessSnapshotClient({
      authorityOrigin,
      clientId: requiredEnvironment("MERCHBASE_ACCESS_TMTERMINAL_CLIENT_ID"),
      clientSecret: requiredEnvironment("MERCHBASE_ACCESS_TMTERMINAL_CLIENT_SECRET"),
      issuer,
      service: "tmterminal",
    }),
    projections,
    resolveServicePrincipal,
    service: "tmterminal" as const,
  };
  const apiVerifier = createCloudflareAssertionVerifier({
    audience: requiredEnvironment("MERCHBASE_ACCESS_API_AUDIENCE"),
    issuer,
    maxMachineLifetimeSeconds: 600,
  });
  const interactive = createCloudflareServiceAccess({
    ...common,
    acceptedPrincipalKinds: ["person"],
    verifier: createCloudflareAssertionVerifier({
      audience: requiredEnvironment("MERCHBASE_ACCESS_INTERACTIVE_AUDIENCE"),
      issuer,
    }),
  });
  const api = createCloudflareServiceAccess({
    ...common,
    acceptedPrincipalKinds: ["person", "api_key"],
    maxConnectionLifetimeSeconds: 300,
    verifier: apiVerifier,
  });
  const mcp = createCloudflareServiceAccess({
    ...common,
    acceptedPrincipalKinds: ["person"],
    maxConnectionLifetimeSeconds: 300,
    verifier: apiVerifier,
  });
  return {
    api: adapt(api, "oauth"),
    development: false,
    interactive: adapt(interactive, "session"),
    mcp: adapt(mcp, "oauth"),
    snapshot: createCloudflareProjectionHandler({
      authorityClientId: requiredEnvironment("MERCHBASE_ACCESS_AUTHORITY_CLIENT_ID"),
      authorityOrigin,
      issuer,
      projections,
      service: "tmterminal",
      verifier: createCloudflareAssertionVerifier({
        audience: requiredEnvironment("MERCHBASE_ACCESS_TMTERMINAL_INTERNAL_AUDIENCE"),
        issuer,
        maxLifetimeSeconds: 600,
      }),
    }),
  };
};

const adapt = (
  access:
    | ReturnType<typeof createCloudflareServiceAccess<AccessPrincipal>>
    | Awaited<ReturnType<typeof createDevCloudflareAccess<AccessPrincipal>>>,
  kind: "oauth" | "session"
): ProductAccess => ({
  authorize: async (assertion) => {
    const authorized = await access.authorize(assertion);
    return {
      ...authorized,
      credentialKind: authorized.credentialKind === "api_key" ? "api_key" : kind,
    };
  },
  evaluateAccess: access.evaluateAccess,
  refreshAccess: access.refreshAccess,
});
const requiredEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ServiceAccessError("access_unavailable");
  }
  return value;
};
