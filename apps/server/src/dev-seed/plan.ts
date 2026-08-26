import { DEV_SIGN_IN_MERCHBASE_USER_ID } from "@merchbaseco/access/dev";

import { defaultSearchPreferences } from "../account-preferences.ts";
import { buildCatalog } from "./build-catalog.ts";
import { buildSourceState } from "./build-source-state.ts";
import { buildUuid } from "./identifiers.ts";
import { createSeededRandom } from "./random.ts";
import { seedTableColumns, seedTableOrder } from "./table-columns.ts";
import { shiftDays } from "./time-offsets.ts";
import type { DevSeedOptions, DevSeedPlan, SeedRow, SeedTableWrite } from "./types.ts";

/**
 * Builds the whole synthetic dataset in memory. The plan is a pure function of
 * the seed string and the current time, which is what makes runs reproducible
 * while still always describing this week.
 */

/**
 * The seeded account belongs to the shared Merchbase Dev Sign-In user, so the
 * developer the automatic development sign-in authenticates as opens the site
 * owning this data rather than looking at someone else's rows.
 */
export const defaultSeedOptions = {
  dayCount: 30,
  markCount: 600,
  merchbaseUserId: DEV_SIGN_IN_MERCHBASE_USER_ID,
  seed: "tmterminal-dev",
} as const;

/**
 * The Merchbase user the seed's account row carried before the Dev Sign-In
 * cutover. The account id is drawn from the seeded RNG, so a database an older
 * seed filled already holds a row at the exact id this run inserts, owned by
 * this fixture user instead. The writer replaces that one row; see
 * `write-plan.ts`.
 */
export const legacySeedMerchbaseUserId = "mbu_dev_seed";

const seedAccountName = "Merchbase Dev Sign-In";

export function buildDevSeedPlan(options: DevSeedOptions): DevSeedPlan {
  const random = createSeededRandom(options.seed);

  const source = buildSourceState({
    dayCount: options.dayCount,
    now: options.now,
    random,
  });

  const catalog = buildCatalog({
    files: source.files,
    markCount: options.markCount,
    now: options.now,
    random,
  });

  const account = buildAccountRow(options, random);

  const rowsByTable: Record<string, SeedRow[]> = {
    account: [account],
    data_state: source.dataState,
    mark: catalog.marks,
    mark_class: catalog.classes,
    mark_goods_services: catalog.goodsServices,
    mark_owner: catalog.owners,
    mark_status_event: catalog.statusEvents,
    source_artifact: source.artifacts,
    trademark_recency: catalog.recency,
    worker_status: source.workerStatus,
  };

  const tables: SeedTableWrite[] = seedTableOrder.map((table) => ({
    columns: seedTableColumns[table],
    rows: rowsByTable[table] ?? [],
    table,
  }));

  return {
    accountId: account.id,
    latestProcessedDate: source.latestProcessedDate,
    merchbaseUserId: options.merchbaseUserId,
    showcaseWordMarks: catalog.showcaseWordMarks,
    summary: Object.fromEntries(tables.map((entry) => [entry.table, entry.rows.length])),
    tables,
  };
}

/**
 * The seed's own account. Its search preferences are deliberately not the
 * defaults, so the account page renders saved choices rather than the shape it
 * would show for a brand-new signup.
 */
function buildAccountRow(options: DevSeedOptions, random: ReturnType<typeof createSeededRandom>) {
  return {
    created_at: shiftDays(options.now, -96).toISOString(),
    id: buildUuid(random),
    merchbase_user_id: options.merchbaseUserId,
    name: seedAccountName,
    search_preferences: {
      ...defaultSearchPreferences,
      defaultSort: "newest-activity",
      defaultStatus: "live",
      pageSize: 50,
      resultDensity: "comfortable",
    },
  } satisfies SeedRow;
}
