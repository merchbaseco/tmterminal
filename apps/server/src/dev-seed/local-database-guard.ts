/**
 * The dev seed clears and refills the trademark tables with fabricated marks.
 * "Not production" is not a safe test for where it may run: the schema's
 * development arm points at the Mac mini over Tailscale, and that host serves
 * the live database (see docs/operations/development.md). The only
 * structurally safe target is a PostgreSQL running on this machine, so the
 * guard allows loopback and refuses everything else, including every hostname
 * that could resolve off-box.
 */

const loopbackHostnames = new Set(["127.0.0.1", "::1", "localhost"]);
const ipv6Brackets = /^\[|\]$/gu;
const leadingSlash = /^\//u;

export interface SeedDatabaseTarget {
  database: string;
  host: string;
  port: string;
}

export class SeedTargetRefusedError extends Error {
  constructor(reason: string, target: string) {
    super(
      [
        "Refusing to seed: the dev seed only runs against a local database.",
        `Reason: ${reason}`,
        `Target: ${target}`,
        "TMTERMINAL_DATABASE_URL must point at 127.0.0.1, ::1, or localhost.",
        "Development resolves to the live Trademark Terminal database over Tailscale, which this seed must never touch.",
        "Start a local PostgreSQL and override the host for the run, for example: TMTERMINAL_DATABASE_HOST=127.0.0.1 bun run db:seed:dev",
      ].join("\n")
    );
    this.name = "SeedTargetRefusedError";
  }
}

export function assertLocalSeedTarget(input: {
  databaseUrl: string;
  nodeEnv?: string;
}): SeedDatabaseTarget {
  const target = parseDatabaseUrl(input.databaseUrl);

  if (input.nodeEnv === "production") {
    throw new SeedTargetRefusedError("NODE_ENV is production", describeTarget(target));
  }

  if (!loopbackHostnames.has(target.host)) {
    throw new SeedTargetRefusedError(
      `database host ${target.host} is not loopback`,
      describeTarget(target)
    );
  }

  return target;
}

export function describeTarget(target: SeedDatabaseTarget) {
  return `${target.host}:${target.port}/${target.database}`;
}

function parseDatabaseUrl(databaseUrl: string): SeedDatabaseTarget {
  // `URL.parse` rather than `new URL` in a catch: the refusal must never carry
  // the connection string, and a parse error's message quotes its input.
  const parsed = URL.parse(databaseUrl);
  if (!parsed) {
    throw new SeedTargetRefusedError(
      "TMTERMINAL_DATABASE_URL is not a parseable URL",
      "(unparseable)"
    );
  }

  return {
    database: parsed.pathname.replace(leadingSlash, "") || "(none)",
    host: parsed.hostname.replace(ipv6Brackets, "").toLowerCase(),
    port: parsed.port || "5432",
  };
}
