import { initTRPC } from "@trpc/server";

const t = initTRPC.create({ isDev: false });

export const appRouter = t.router({});

export type AppRouter = typeof appRouter;
