import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { CorpusUnavailableError } from "../queries/corpus-errors.ts";
import { CorpusVersionConflictError } from "../queries/multi-search.ts";
import type {
  AccountService,
  AuthenticatedAccount,
  MarksService,
  OperatorSyncService,
  SyncService,
} from "./contracts.ts";
import { multiSearchInputSchema } from "./multi-search-input.ts";

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
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

function throwCorpusUnavailable(error: unknown): never {
  if (error instanceof CorpusUnavailableError) {
    throw new TRPCError({ cause: error, code: "SERVICE_UNAVAILABLE", message: error.message });
  }
  throw error;
}

const accountRouter = t.router({
  "api-keys": t.router({
    create: clerkProcedure
      .input(z.object({ name: z.string().trim().min(1).max(80) }))
      .mutation(({ ctx, input }) => ctx.account.createApiKey(input.name)),
    list: clerkProcedure.query(({ ctx }) => ctx.account.listApiKeys()),
    revoke: clerkProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
      const key = await ctx.account.revokeApiKey(input.id);
      if (!key) {
        throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      }
      return key;
    }),
  }),
  me: t.procedure.query(({ ctx }) => ctx.auth),
});

const marksRouter = t.router({
  get: t.procedure
    .input(z.object({ serialNumber: z.string().regex(/^\d{8}$/) }))
    .query(async ({ ctx, input }) => {
      const mark = await ctx.marks
        .getBySerialNumber(input.serialNumber)
        .catch(throwCorpusUnavailable);
      if (!mark) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trademark not found" });
      }
      return mark;
    }),
  "get-by-registration": t.procedure
    .input(z.object({ registrationNumber: z.string().regex(/^\d{7}$/) }))
    .query(async ({ ctx, input }) => {
      const mark = await ctx.marks
        .getByRegistrationNumber(input.registrationNumber)
        .catch(throwCorpusUnavailable);
      if (!mark) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trademark not found" });
      }
      return mark;
    }),
  search: t.procedure.input(multiSearchInputSchema).query(async ({ ctx, input }) => {
    try {
      return await ctx.marks.search(input);
    } catch (error) {
      if (error instanceof CorpusVersionConflictError) {
        // biome-ignore lint/style/useErrorCause: TRPCError receives the original cause in its options.
        throw new TRPCError({ cause: error, code: "CONFLICT", message: error.message });
      }
      if (error instanceof CorpusUnavailableError) {
        throwCorpusUnavailable(error);
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
