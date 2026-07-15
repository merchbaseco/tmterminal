import { TRPCError } from "@trpc/server";
import type postgres from "postgres";

import type { VerifyClerkToken } from "../auth/clerk-verifier.ts";
import { CredentialSelectionError, selectCredential } from "../auth/select-credential.ts";
import { resolveClerkAccount } from "../queries/account-repository.ts";
import { authenticateApiKey } from "../queries/api-key-repository.ts";
import { createAccountService } from "../services/account-service.ts";
import { createMarksService } from "../services/marks-service.ts";
import type { AuthenticatedAccount } from "./contracts.ts";
import type { AppContext } from "./router.ts";

type CreateContextOptions = {
  authorization?: string;
  cookie?: string;
  database: postgres.Sql;
  verifyClerkToken: VerifyClerkToken;
};

function context(database: postgres.Sql, auth: AuthenticatedAccount): AppContext {
  return {
    account: createAccountService(database, auth.accountId),
    auth,
    marks: createMarksService(database),
  };
}

export async function createAppContext({
  authorization,
  cookie,
  database,
  verifyClerkToken,
}: CreateContextOptions): Promise<AppContext> {
  let selected;

  try {
    selected = selectCredential({ authorization, cookie });
  } catch (error) {
    if (error instanceof CredentialSelectionError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Select exactly one credential" });
    }
    throw error;
  }

  if (!selected) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }

  if (selected.type === "api-key") {
    const key = await authenticateApiKey(database, selected.token);
    if (!key) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credential" });
    }
    return context(database, {
      accountId: key.accountId,
      credential: { type: "api-key", keyId: key.keyId, suffix: key.suffix },
    });
  }

  const clerkUserId = await verifyClerkToken(selected.token);
  if (!clerkUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credential" });
  }

  return context(database, {
    accountId: await resolveClerkAccount(database, clerkUserId),
    credential: { type: "clerk" },
  });
}
