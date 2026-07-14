import { initTRPC, TRPCError } from "@trpc/server";
import type postgres from "postgres";
import { z } from "zod";

import type { VerifyClerkToken } from "../auth/clerk-verifier.ts";
import { CredentialSelectionError, selectCredential } from "../auth/select-credential.ts";
import { resolveClerkAccount } from "../queries/account-repository.ts";
import {
  type ApiKeyView,
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../queries/api-key-repository.ts";

function publicApiKey(key: ApiKeyView) {
  return {
    ...key,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  };
}

export type AuthenticatedAccount = {
  accountId: string;
  credential: { type: "api-key"; keyId: string; suffix: string } | { type: "clerk" };
};

export type AppContext = {
  auth: AuthenticatedAccount;
  database: postgres.Sql;
};

type CreateContextOptions = {
  authorization?: string;
  cookie?: string;
  database: postgres.Sql;
  verifyClerkToken: VerifyClerkToken;
};

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

    return {
      auth: {
        accountId: key.accountId,
        credential: { type: "api-key", keyId: key.keyId, suffix: key.suffix },
      },
      database,
    };
  }

  const clerkUserId = await verifyClerkToken(selected.token);
  if (!clerkUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credential" });
  }

  return {
    auth: {
      accountId: await resolveClerkAccount(database, clerkUserId),
      credential: { type: "clerk" },
    },
    database,
  };
}

const t = initTRPC.context<AppContext>().create({ isDev: false });
const clerkProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.auth.credential.type !== "clerk") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Clerk authentication required" });
  }
  return next({ ctx });
});

export const appRouter = t.router({
  account: t.router({
    me: t.procedure.query(({ ctx }) => ctx.auth),
    "api-keys": t.router({
      create: clerkProcedure
        .input(z.object({ name: z.string().trim().min(1).max(80) }))
        .mutation(async ({ ctx, input }) => {
          const created = await createApiKey(ctx.database, ctx.auth.accountId, input.name);
          return { ...created, key: publicApiKey(created.key) };
        }),
      list: clerkProcedure.query(async ({ ctx }) =>
        (await listApiKeys(ctx.database, ctx.auth.accountId)).map(publicApiKey),
      ),
      revoke: clerkProcedure
        .input(z.object({ id: z.uuid() }))
        .mutation(async ({ ctx, input }) => {
          const key = await revokeApiKey(ctx.database, ctx.auth.accountId, input.id);
          if (!key) {
            throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
          }
          return publicApiKey(key);
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
