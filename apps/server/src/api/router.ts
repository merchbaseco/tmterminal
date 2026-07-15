import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";

import type { AccountService, AuthenticatedAccount, MarksService } from "./contracts.ts";

export type AppContext = {
  account: AccountService;
  auth: AuthenticatedAccount;
  marks: MarksService;
};

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
        .mutation(({ ctx, input }) => ctx.account.createApiKey(input.name)),
      list: clerkProcedure.query(({ ctx }) => ctx.account.listApiKeys()),
      revoke: clerkProcedure
        .input(z.object({ id: z.uuid() }))
        .mutation(async ({ ctx, input }) => {
          const key = await ctx.account.revokeApiKey(input.id);
          if (!key) {
            throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
          }
          return key;
        }),
    }),
  }),
  marks: t.router({
    get: t.procedure
      .input(z.object({ serialNumber: z.string().regex(/^\d{8}$/) }))
      .query(async ({ ctx, input }) => {
        const mark = await ctx.marks.getBySerialNumber(input.serialNumber);
        if (!mark) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Trademark not found" });
        }
        return mark;
      }),
    "get-by-registration": t.procedure
      .input(z.object({ registrationNumber: z.string().regex(/^\d{7}$/) }))
      .query(async ({ ctx, input }) => {
        const mark = await ctx.marks.getByRegistrationNumber(input.registrationNumber);
        if (!mark) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Trademark not found" });
        }
        return mark;
      }),
  }),
});

export type AppRouter = typeof appRouter;
