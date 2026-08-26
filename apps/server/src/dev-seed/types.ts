/**
 * Row shapes for the synthetic dev dataset. Keys are database column names so
 * the writer can hand each list straight to `jsonb_to_recordset` without a
 * second mapping layer.
 */

export type SeedRow = Record<string, unknown>;

export interface DevSeedOptions {
  /** Number of days of source-file history, ending yesterday. */
  dayCount: number;
  markCount: number;
  merchbaseUserId: string;
  now: Date;
  seed: string;
}

/** The child-row lists a mark's detail builders append to. */
export interface MarkDetailSink {
  classes: SeedRow[];
  goodsServices: SeedRow[];
  owners: SeedRow[];
  statusEvents: SeedRow[];
}

export interface SeedTableWrite {
  columns: Record<string, string>;
  rows: SeedRow[];
  table: string;
}

export interface DevSeedPlan {
  /** The seeded account's id, drawn from the seeded RNG and stable across runs. */
  accountId: string;
  /** The day the newest applied source file covers; the catalog is anchored to it. */
  latestProcessedDate: string;
  merchbaseUserId: string;
  /** Word marks the docs promise a developer can search for and find. */
  showcaseWordMarks: string[];
  /** Row counts per table, in write order. */
  summary: Record<string, number>;
  tables: SeedTableWrite[];
}

export interface SeedSourceFile {
  /** Marks are attributed to a file only once it has been applied. */
  applied: boolean;
  /** Transaction day the file's records carry. */
  day: string;
  filename: string;
  product: string;
  sha256: string;
}
