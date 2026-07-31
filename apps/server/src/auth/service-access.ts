import {
  createClerkAccessWebhookHandler,
  createClerkAuthenticator,
  createServiceAccess,
} from "@merchbaseco/access";
import type postgres from "postgres";

import { createAccessProjectionStore } from "../queries/access-projection-store.ts";
import { resolveMerchbaseAccount } from "../queries/account-repository.ts";

export interface AccessPrincipal {
  accountId: string;
}

type ProductAccess = ReturnType<typeof createServiceAccess<AccessPrincipal>>;

export interface TmterminalAccess {
  customer: ProductAccess;
  oauth: ProductAccess;
  webhook: (request: Request) => Promise<Response>;
}

export function createConfiguredTmterminalAccess(database: postgres.Sql): TmterminalAccess {
  const configured = createConfiguredAccessServices(database);
  return {
    customer: configured.customer,
    oauth: configured.oauth,
    webhook: createClerkAccessWebhookHandler({
      issuer: configured.issuer,
      onIdentityChanged: configured.authenticator.invalidateApiKeys,
      signingSecret: requiredEnvironment("CLERK_WEBHOOK_SIGNING_SECRET"),
      store: configured.projections,
    }),
  };
}

export function createConfiguredCustomerAccess(database: postgres.Sql) {
  return createConfiguredAccessServices(database).customer;
}

function createConfiguredAccessServices(database: postgres.Sql) {
  const issuer = requiredEnvironment("CLERK_ISSUER");
  const authenticator = createClerkAuthenticator({
    authorizedParties: requiredEnvironment("CLERK_AUTHORIZED_PARTIES")
      .split(",")
      .map((party) => party.trim())
      .filter(Boolean),
    issuer,
    jwtKey: requiredEnvironment("CLERK_JWT_KEY"),
    publishableKey: requiredEnvironment("CLERK_PUBLISHABLE_KEY"),
    secretKey: requiredEnvironment("CLERK_SECRET_KEY"),
  });
  const projections = createAccessProjectionStore(database);
  const resolveServicePrincipal = async ({ merchbaseUserId }: { merchbaseUserId: string }) => ({
    accountId: await resolveMerchbaseAccount(database, merchbaseUserId),
  });
  const shared = {
    authenticator,
    projections,
    resolveServicePrincipal,
    service: "tmterminal" as const,
  };

  const customer = createServiceAccess({
    ...shared,
    acceptedCredentialKinds: ["session", "api_key"],
  });
  const oauth = createServiceAccess({
    ...shared,
    acceptedCredentialKinds: ["oauth"],
  });
  return {
    authenticator,
    customer,
    issuer,
    oauth,
    projections,
  };
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
