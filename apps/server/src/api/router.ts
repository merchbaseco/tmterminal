import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { searchPreferencesSchema } from "../account-preferences.ts";
import { DataVersionConflictError } from "../queries/data-snapshot.ts";
import type {
  AccountService,
  AuthenticatedAccount,
  MarksService,
  OperatorSyncService,
  SyncService,
} from "./contracts.ts";
import {
  listMarksInputSchema,
  markIdentitySchema,
  matchTextsInputSchema,
  screenQueriesInputSchema,
} from "./marks-input.ts";
import { searchInputSchema } from "./search-input.ts";

export interface AppContext {
  account: AccountService;
  auth: AuthenticatedAccount;
  marks: MarksService;
  operator: boolean;
  operatorSync: OperatorSyncService;
  sync: SyncService;
}

const t = initTRPC.context<AppContext>().create({ isDev: false });
const clerkProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.auth.credential.type !== "clerk") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Clerk authentication required" });
  }
  return next({ ctx });
});

const operatorProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.auth.credential.type !== "clerk" || !ctx.operator) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Operator access required" });
  }
  return next({ ctx });
});

const operatorPageInput = z.object({
  filter: z.enum(["all", "needs-attention"]).default("all"),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

const accountRouter = t.router({
  "api-keys": t.router({
    create: clerkProcedure
      .input(z.object({ name: z.string().trim().min(1).max(80) }))
      .mutation(({ ctx, input }) => ctx.account.createApiKey(input.name)),
    list: clerkProcedure.query(({ ctx }) => ctx.account.listApiKeys()),
    revoke: clerkProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
      const revoked = await ctx.account.revokeApiKey(input.id);
      if (!revoked) {
        throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      }
      return revoked;
    }),
  }),
  me: t.procedure.query(({ ctx }) => ctx.auth),
  preferences: t.router({
    get: clerkProcedure.query(({ ctx }) => ctx.account.getSearchPreferences()),
    update: clerkProcedure
      .input(searchPreferencesSchema)
      .mutation(({ ctx, input }) => ctx.account.updateSearchPreferences(input)),
  }),
});

const marksRouter = t.router({
  get: t.procedure.input(markIdentitySchema).query(async ({ ctx, input }) => {
    const mark = await ctx.marks.get(input);
    if (!mark) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Trademark not found" });
    }
    return mark;
  }),
  list: t.procedure.input(listMarksInputSchema).query(async ({ ctx, input }) => {
    try {
      return await ctx.marks.list(input);
    } catch (error) {
      if (error instanceof DataVersionConflictError) {
        // biome-ignore lint/style/useErrorCause: TRPCError receives the original cause in its options.
        throw new TRPCError({ cause: error, code: "CONFLICT", message: error.message });
      }
      throw error;
    }
  }),
  match: t.procedure.input(matchTextsInputSchema).query(({ ctx, input }) => ctx.marks.match(input)),
  screen: t.procedure
    .input(screenQueriesInputSchema)
    .query(({ ctx, input }) => ctx.marks.screen(input)),
  search: t.procedure.input(searchInputSchema).query(async ({ ctx, input }) => {
    try {
      return await ctx.marks.search(input);
    } catch (error) {
      if (error instanceof DataVersionConflictError) {
        // biome-ignore lint/style/useErrorCause: TRPCError receives the original cause in its options.
        throw new TRPCError({ cause: error, code: "CONFLICT", message: error.message });
      }
      throw error;
    }
  }),
});

const syncRouter = t.router({
  status: t.procedure.query(({ ctx }) => ctx.sync.status()),
});

export const authenticatedClientRouter = t.router({
  account: accountRouter,
  marks: marksRouter,
  sync: syncRouter,
});

export const appRouter = t.router({
  account: accountRouter,
  marks: marksRouter,
  ops: t.router({
    sync: t.router({
      artifacts: operatorProcedure
        .input(operatorPageInput)
        .query(({ ctx, input }) => ctx.operatorSync.artifacts(input)),
      status: operatorProcedure.query(({ ctx }) => ctx.operatorSync.status()),
    }),
  }),
  sync: syncRouter,
  viewer: t.router({
    role: clerkProcedure.query(({ ctx }) => ({ operator: ctx.operator })),
  }),
});

export type AppRouter = typeof appRouter;
export type AuthenticatedClientRouter = typeof authenticatedClientRouter;
