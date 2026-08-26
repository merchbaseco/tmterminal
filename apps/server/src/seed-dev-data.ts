import { bootstrapDevAccessProjection } from "@merchbaseco/access/dev";
import postgres from "postgres";

import { migrateDatabase } from "./db/migrate.ts";
import { assertLocalSeedTarget, describeTarget } from "./dev-seed/local-database-guard.ts";
import { buildDevSeedPlan, defaultSeedOptions } from "./dev-seed/plan.ts";
import { writeDevSeedPlan } from "./dev-seed/write-plan.ts";
import { createAccessProjectionStore } from "./queries/access-projection-store.ts";

/**
 * Fills a local database with a synthetic week of trademark data so search,
 * mark detail, screening, and Source Status have something to render. Never
 * auto-runs on a workstation: development points at the live database over
 * Tailscale, and the loopback guard is what keeps this away from it.
 *
 *   bun run db:seed:dev
 *   bun run db:seed:dev --seed=friday --marks=200 --days=14
 *
 * Authorization comes first. A migrated database holds no Access Projection —
 * those arrive by Clerk webhook, and no webhook is ever delivered to a
 * workstation or a cloud VM — so every request would fail before any of this
 * data could be seen. `bootstrapDevAccessProjection` writes the projection the
 * webhook would have written for the shared Merchbase Dev Sign-In user through
 * this repository's own store, and the seeded account is that user's.
 *
 * Every row is fabricated locally. The seed never contacts the USPTO Open Data
 * Portal, and it never leaves an artifact in a state a running ingestion
 * worker would reserve — see `dev-seed/build-source-state.ts`.
 */

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [name, ...rest] = value.split("=");
    return [name, rest.join("=")] as const;
  })
);

const databaseUrl = process.env.TMTERMINAL_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TMTERMINAL_DATABASE_URL is required. Run through `bunx varlock run --`.");
}

const target = assertLocalSeedTarget({ databaseUrl, nodeEnv: process.env.NODE_ENV });

// The exact value `createClerkAuthenticator` runs with: a projection written
// under a different issuer authorizes nobody.
const issuer = process.env.MERCHBASE_CLERK_ISSUER?.trim();
if (!issuer) {
  throw new Error("MERCHBASE_CLERK_ISSUER is required. Run through `bunx varlock run --`.");
}

const options = {
  dayCount: readInt("--days", defaultSeedOptions.dayCount),
  markCount: readInt("--marks", defaultSeedOptions.markCount),
  merchbaseUserId: args.get("--merchbase-user-id") || defaultSeedOptions.merchbaseUserId,
  now: new Date(),
  seed: args.get("--seed") || defaultSeedOptions.seed,
};

const startedAt = Date.now();
const database = postgres(databaseUrl, { max: 1 });

try {
  await migrateDatabase(databaseUrl);
  const access = await bootstrapDevAccessProjection({
    databaseUrl,
    issuer,
    service: "tmterminal",
    store: createAccessProjectionStore(database),
  });
  const plan = buildDevSeedPlan(options);
  await writeDevSeedPlan(database, plan);

  process.stdout.write(
    `${JSON.stringify(
      {
        accessProjection: {
          clerkSubject: access.clerkSubject,
          issuer: access.issuer,
          merchbaseUserId: access.merchbaseUserId,
        },
        dayCount: options.dayCount,
        durationMs: Date.now() - startedAt,
        latestProcessedDate: plan.latestProcessedDate,
        merchbaseUserId: plan.merchbaseUserId,
        rows: plan.summary,
        seed: options.seed,
        showcaseWordMarks: plan.showcaseWordMarks,
        target: describeTarget(target),
      },
      null,
      2
    )}\n`
  );
} finally {
  await database.end({ timeout: 1 });
}

function readInt(name: string, fallback: number) {
  const raw = args.get(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
