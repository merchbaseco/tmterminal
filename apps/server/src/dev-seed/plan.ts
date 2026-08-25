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

export const defaultSeedOptions = {
  dayCount: 30,
  markCount: 600,
  merchbaseUserId: "mbu_dev_seed",
  seed: "tmterminal-dev",
} as const;

const seedAccountName = "Dev Seed Terminal";

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

  const rowsByTable: Record<string, SeedRow[]> = {
    account: [buildAccountRow(options, random)],
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
