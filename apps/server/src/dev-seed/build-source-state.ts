import { buildHexToken, buildUuid } from "./identifiers.ts";
import type { SeededRandom } from "./random.ts";
import { dayLabel, shiftDays, shiftMinutes } from "./time-offsets.ts";
import type { SeedRow, SeedSourceFile } from "./types.ts";

/**
 * Builds the Source Status surface: one USPTO source file per day of the
 * window, an annual baseline behind them, and the worker's own row.
 *
 * Every artifact here is deliberately un-reservable by a running ingestion
 * worker. The worker claims work with three predicates, and the seed avoids
 * all three, so a seeded database can never turn into an outbound USPTO
 * request or a read of artifact bytes that were never downloaded:
 *
 *   download    `processing_disposition = 'required' and download_state = 'pending'`
 *   application `download_state = 'downloaded' and object_key is not null
 *                and sha256 is not null and application_state in ('pending','applying')`
 *   recovery    `download_state = 'downloading' and object_key is null`
 *
 * So: nothing is ever left `downloading`; a `pending` download is always
 * `deferred`; and anything still awaiting application carries a null
 * `object_key`. `last_discovery_at` is seeded fresh for the same reason —
 * discovery is due only once a day, so a worker attached to a freshly seeded
 * database has nothing to do.
 */

const dailyProduct = "TRTDXFAP";
const annualProduct = "TRTYRAP";
const annualBaselineAgeDays = 204;
const parserVersion = "uspto-projection-v2";
const blockedRetryMinutes = 47;

interface DailyShape {
  applied: boolean;
  kind:
    | "applying"
    | "awaiting-application"
    | "blocked"
    | "complete"
    | "deferred"
    | "needs-attention";
}

export interface SourceState {
  artifacts: SeedRow[];
  dataState: SeedRow[];
  /** Applied files, for attributing marks to the artifact that carried them. */
  files: SeedSourceFile[];
  latestProcessedDate: string;
  workerStatus: SeedRow[];
}

export function buildSourceState(input: {
  dayCount: number;
  now: Date;
  random: SeededRandom;
}): SourceState {
  const { now, random } = input;
  const artifacts: SeedRow[] = [];
  const files: SeedSourceFile[] = [];

  const annual = buildAnnualBaseline({ now, random });
  artifacts.push(annual.row);
  files.push(annual.file);

  // Day offsets run oldest first so the newest file is the one the tail
  // states land on, exactly as a real catch-up sweep would leave them.
  for (let offset = input.dayCount; offset >= 1; offset -= 1) {
    const daily = buildDailyArtifact({ dayOffset: offset, now, random });
    artifacts.push(daily.row);
    if (daily.file) {
      files.push(daily.file);
    }
  }

  const latestProcessedDate = files
    .filter((file) => file.applied && file.product === dailyProduct)
    .map((file) => file.day)
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
  if (!latestProcessedDate) {
    throw new Error("The dev seed produced no applied daily source file.");
  }

  return {
    artifacts,
    dataState: [
      {
        id: "uspto",
        last_successful_update_at: shiftMinutes(now, -random.int(9, 40)).toISOString(),
        version: 1000 + artifacts.length * 7,
      },
    ],
    files,
    latestProcessedDate,
    workerStatus: [buildWorkerStatus({ artifacts, now })],
  };
}

/**
 * Most days applied cleanly; a few did not. The unapplied ones are scattered
 * through the window rather than stacked on the newest days, so Source Status
 * shows a pending queue, a blocked download, and a file needing attention
 * while Latest Processed still reads like this week.
 */
function dailyShape(dayOffset: number): DailyShape {
  switch (dayOffset) {
    case 1:
      // The newest file, mid-apply. `object_key` stays null, so the worker's
      // application reservation skips it while it still counts as pending work.
      return { applied: false, kind: "applying" } as const;
    case 3:
      return { applied: false, kind: "awaiting-application" } as const;
    case 5:
      return { applied: false, kind: "blocked" } as const;
    case 8:
      return { applied: false, kind: "needs-attention" } as const;
    case 11:
      // Deferred, so it is not a download the worker would ever reserve.
      return { applied: false, kind: "deferred" } as const;
    default:
      return { applied: true, kind: "complete" } as const;
  }
}

function buildDailyArtifact(input: { dayOffset: number; now: Date; random: SeededRandom }) {
  const { dayOffset, now, random } = input;
  const day = dayLabel(shiftDays(now, -dayOffset));
  const shape = dailyShape(dayOffset);
  const filename = `apc${day.replace(/-/gu, "")}.zip`;
  const sha256 = buildHexToken(random, 64);
  const expectedBytes = random.int(9_000_000, 41_000_000);
  const physicalRecordCount = random.int(3200, 9800);
  const updatedAt = shiftMinutes(now, -random.int(3, 180));

  const base: SeedRow = {
    application_completed_at: null,
    application_state: "pending",
    applied_record_count: 0,
    bytes: null,
    content_revision: 1,
    current_error: null,
    download_request_count: 0,
    download_response_state: null,
    download_state: "pending",
    downloaded_at: null,
    expected_bytes: expectedBytes,
    filename,
    id: buildUuid(random),
    object_key: null,
    parser_version: null,
    physical_record_count: 0,
    processing_disposition: "required",
    product: dailyProduct,
    projected_mark_count: 0,
    sha256: null,
    source_from_date: day,
    source_to_date: day,
    unresolved_record_count: 0,
    updated_at: updatedAt.toISOString(),
  };

  const downloaded: SeedRow = {
    ...base,
    bytes: expectedBytes,
    download_request_count: 1,
    download_state: "downloaded",
    downloaded_at: shiftMinutes(updatedAt, -random.int(4, 30)).toISOString(),
    sha256,
  };

  const row = applyShape({ base, downloaded, expectedBytes, physicalRecordCount, random, shape });

  return {
    file: shape.applied
      ? ({ applied: true, day, filename, product: dailyProduct, sha256 } satisfies SeedSourceFile)
      : null,
    row,
  };
}

function applyShape(input: {
  base: SeedRow;
  downloaded: SeedRow;
  expectedBytes: number;
  physicalRecordCount: number;
  random: SeededRandom;
  shape: DailyShape;
}): SeedRow {
  const { base, downloaded, physicalRecordCount, random, shape } = input;
  const appliedRecordCount = Math.floor(physicalRecordCount * random.between(0.82, 0.97));

  switch (shape.kind) {
    case "complete":
      return {
        ...downloaded,
        application_completed_at: String(downloaded.updated_at),
        application_state: "complete",
        applied_record_count: appliedRecordCount,
        parser_version: parserVersion,
        physical_record_count: physicalRecordCount,
        projected_mark_count: appliedRecordCount,
        unresolved_record_count: physicalRecordCount - appliedRecordCount,
      };
    case "applying":
      return { ...downloaded, application_state: "applying" };
    case "awaiting-application":
      return downloaded;
    case "blocked":
      return {
        ...base,
        download_request_count: random.int(2, 4),
        download_response_state: {
          providerRequestCount: random.int(2, 4),
          retryNotBefore: shiftMinutes(
            new Date(String(base.updated_at)),
            blockedRetryMinutes
          ).toISOString(),
          status: 429,
        },
        download_state: "blocked",
      };
    case "needs-attention":
      return {
        ...downloaded,
        application_state: "needs_attention",
        current_error: "Trademark record 98261145 is missing a case-file header",
        // Bytes stay retained so Source Status has a repairable file to show.
        object_key: `uspto/${String(base.filename)}`,
        parser_version: parserVersion,
        physical_record_count: physicalRecordCount,
      };
    case "deferred":
      return { ...base, processing_disposition: "deferred" };
    default:
      return shape.kind satisfies never;
  }
}

function buildAnnualBaseline(input: { now: Date; random: SeededRandom }) {
  const { now, random } = input;
  const day = dayLabel(shiftDays(now, -annualBaselineAgeDays));
  const year = new Date(day).getUTCFullYear();
  const filename = `apc${year}.zip`;
  const sha256 = buildHexToken(random, 64);
  const physicalRecordCount = random.int(2_400_000, 2_900_000);
  const appliedRecordCount = Math.floor(physicalRecordCount * 0.94);
  const updatedAt = shiftDays(now, -annualBaselineAgeDays + 1);

  return {
    file: { applied: true, day, filename, product: annualProduct, sha256 } satisfies SeedSourceFile,
    row: {
      application_completed_at: updatedAt.toISOString(),
      application_state: "complete",
      applied_record_count: appliedRecordCount,
      bytes: 6_180_331_008,
      content_revision: 1,
      current_error: null,
      download_request_count: 1,
      download_response_state: null,
      download_state: "downloaded",
      downloaded_at: shiftDays(now, -annualBaselineAgeDays).toISOString(),
      expected_bytes: 6_180_331_008,
      filename,
      id: buildUuid(random),
      object_key: null,
      parser_version: parserVersion,
      physical_record_count: physicalRecordCount,
      // The dailies since have superseded it, which is what `covered` means.
      processing_disposition: "covered",
      product: annualProduct,
      projected_mark_count: appliedRecordCount,
      sha256,
      source_from_date: `${year}-01-01`,
      source_to_date: day,
      unresolved_record_count: physicalRecordCount - appliedRecordCount,
      updated_at: updatedAt.toISOString(),
    } satisfies SeedRow,
  };
}

/**
 * A fresh heartbeat and a fresh discovery stamp. The heartbeat ages out after
 * five minutes and Source Status then reports the worker as failed — which is
 * the truth about a database with no worker attached, and what a re-seed
 * clears.
 */
function buildWorkerStatus(input: { artifacts: SeedRow[]; now: Date }): SeedRow {
  const applying = input.artifacts.find((artifact) => artifact.application_state === "applying");

  return {
    activity: "applying",
    current_error: null,
    current_filename: applying ? String(applying.filename) : null,
    id: "uspto",
    last_discovery_at: shiftMinutes(input.now, -18).toISOString(),
    last_heartbeat_at: input.now.toISOString(),
    updated_at: input.now.toISOString(),
  };
}
