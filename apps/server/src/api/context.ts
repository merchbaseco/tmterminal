import { ServiceAccessError, type ServiceAccessErrorCode } from "@merchbaseco/access";
import { TRPCError } from "@trpc/server";
import type postgres from "postgres";

import type { TmterminalAccess } from "../auth/service-access.ts";
import { accountIsOperator } from "../queries/account-repository.ts";
import { createAccountService } from "../services/account-service.ts";
import { createMarksService } from "../services/marks-service.ts";
import { createOperatorSyncService } from "../services/operator-sync-service.ts";
import { createSyncService } from "../services/sync-service.ts";
import type { AuthenticatedAccount } from "./contracts.ts";
import type { AppContext } from "./router.ts";

interface CreateContextOptions {
  access: TmterminalAccess["interactive"] | TmterminalAccess["api"];
  assertion?: string;
  database: postgres.Sql;
  devOperatorMerchbaseUserId?: string;
}

const accessErrorResponse = {
  access_denied: { code: "FORBIDDEN", message: "Access denied" },
  access_unavailable: { code: "SERVICE_UNAVAILABLE", message: "Access unavailable" },
  insufficient_scope: { code: "FORBIDDEN", message: "Insufficient scope" },
  unauthenticated: { code: "UNAUTHORIZED", message: "Invalid credential" },
  unknown_service: { code: "SERVICE_UNAVAILABLE", message: "Access unavailable" },
} as const satisfies Record<
  ServiceAccessErrorCode,
  { code: "FORBIDDEN" | "SERVICE_UNAVAILABLE" | "UNAUTHORIZED"; message: string }
>;

export function createAuthenticatedAppContext(
  database: postgres.Sql,
  auth: AuthenticatedAccount,
  operator = false
): AppContext {
  return {
    account: createAccountService(database, auth.accountId),
    auth,
    marks: createMarksService(database),
    operator,
    operatorSync: createOperatorSyncService(database),
    sync: createSyncService(database),
  };
}

export async function createAppContext({
  access,
  assertion,
  database,
  devOperatorMerchbaseUserId,
}: CreateContextOptions): Promise<AppContext> {
  let authorized: Awaited<ReturnType<typeof access.authorize>>;
  try {
    authorized = await access.authorize(assertion ?? "");
  } catch (error) {
    throw accessError(error);
  }

  const auth: AuthenticatedAccount = {
    accountId: authorized.principal.accountId,
    credential: {
      type: authorized.credentialKind === "api_key" ? "api-key" : authorized.credentialKind,
    },
  };
  const operator =
    (auth.credential.type === "session" &&
      authorized.merchbaseUserId === devOperatorMerchbaseUserId) ||
    (auth.credential.type === "session" &&
      (await accountIsOperator(database, authorized.principal.accountId)));

  return createAuthenticatedAppContext(database, auth, operator);
}

function accessError(error: unknown) {
  if (!(error instanceof ServiceAccessError)) {
    return new TRPCError({
      cause: error,
      code: "SERVICE_UNAVAILABLE",
      message: "Access unavailable",
    });
  }
  return new TRPCError({ cause: error, ...accessErrorResponse[error.code] });
}
