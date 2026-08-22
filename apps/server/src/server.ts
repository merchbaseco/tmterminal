import { buildServer } from "./api/server.ts";

const databaseUrl = process.env.TMTERMINAL_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TMTERMINAL_DATABASE_URL is required");
}

const server = await buildServer({ databaseUrl });
const port = Number(process.env.TMTERMINAL_PORT ?? 3000);
const host = process.env.TMTERMINAL_HOST ?? "0.0.0.0";

await server.listen({ host, port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
