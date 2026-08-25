import { addClassesAndGoods, addOwners, addStatusEvents } from "./build-mark-detail.ts";
import { buildHexToken } from "./identifiers.ts";
import type { SeededRandom } from "./random.ts";
import { dayLabel, shiftDays } from "./time-offsets.ts";
import type { MarkDetailSink, SeedRow, SeedSourceFile } from "./types.ts";
import {
  deadStatusCodes,
  drawingCodes,
  liveStatusCodes,
  soloMarks,
  subjectWords,
  themeWords,
  toneWords,
  unknownStatusCodes,
} from "./vocabulary.ts";

/**
 * Builds the trademark catalog: one mark row and one recency row per serial,
 * with `build-mark-detail.ts` filling in each mark's children.
 *
 * Two shapes matter more than volume. Word marks crowd deliberately — several
 * serials share one word mark and many share a token — because that is what
 * makes Multi, Split, Wildcard, and screening return interesting counts
 * instead of one row each. And activity concentrates in the last seven days,
 * so the Source Status chart and the newest-activity sort describe a current
 * week rather than a flat history.
 */

const dailyProduct = "TRTDXFAP";
const recentActivityShare = 0.6;
const recentActivityDays = 7;
const recentDrawExponent = 1.8;
const baselineShare = 0.15;
const registeredShare = 0.45;
const recentFilingShare = 0.08;
const liveShare = 0.7;
const deadShare = 0.95;
const soloRepeatMin = 2;
const soloRepeatMax = 4;
const oldestFilingDays = 2200;
const newestBacklogFilingDays = 180;

export interface Catalog extends MarkDetailSink {
  marks: SeedRow[];
  recency: SeedRow[];
  showcaseWordMarks: string[];
}

export function buildCatalog(input: {
  files: SeedSourceFile[];
  markCount: number;
  now: Date;
  random: SeededRandom;
}): Catalog {
  const { random } = input;
  const catalog: Catalog = {
    classes: [],
    goodsServices: [],
    marks: [],
    owners: [],
    recency: [],
    showcaseWordMarks: [...soloMarks],
    statusEvents: [],
  };

  const serials = buildSerialNumbers(input.markCount, random);
  const wordMarks = buildWordMarks(input.markCount, random);
  const registrationNumbers = buildRegistrationNumbers(input.markCount, random);

  for (const [index, serialNumber] of serials.entries()) {
    const wordMark = wordMarks[index];
    if (wordMark === undefined) {
      throw new Error("The dev seed ran out of word marks before serial numbers.");
    }
    addMark({
      ...input,
      catalog,
      // Every showcase mark is live, because screening and the live-match
      // counts the docs promise only ever return live marks.
      forceLive: index < soloMarks.length * soloRepeatMin,
      registrationNumber: registrationNumbers[index] ?? null,
      serialNumber,
      wordMark,
    });
  }

  return catalog;
}

function addMark(input: {
  catalog: Catalog;
  files: SeedSourceFile[];
  forceLive: boolean;
  now: Date;
  random: SeededRandom;
  registrationNumber: string | null;
  serialNumber: string;
  wordMark: string;
}) {
  const { catalog, forceLive, now, random, serialNumber, wordMark } = input;
  const file = pickSourceFile(input);
  const transactionDate = file.day;
  const statusCode = pickStatusCode(random, forceLive);
  const filingDate = pickFilingDate({ now, random, transactionDate });
  const registered = input.registrationNumber !== null && random.next() < registeredShare;
  const registrationDate = registered
    ? dayLabel(shiftDays(new Date(filingDate), random.int(280, 900)))
    : null;
  const physicalRecordIndex = random.int(1, 9000);
  const snapshotHash = buildHexToken(random, 64);
  const source = {
    source_filename: file.filename,
    source_physical_record_index: physicalRecordIndex,
    source_product: file.product,
    source_sha256: file.sha256,
  };

  catalog.marks.push({
    ...source,
    filing_date: filingDate,
    mark_drawing_code: random.pick(drawingCodes),
    normalization_version: "uspto-normalization-v1",
    registration_date:
      registrationDate && registrationDate <= dayLabel(now) ? registrationDate : null,
    registration_number:
      registrationDate && registrationDate <= dayLabel(now) ? input.registrationNumber : null,
    serial_number: serialNumber,
    source_content_revision: 1,
    source_parser_version: "uspto-projection-v2",
    source_snapshot_hash: snapshotHash,
    source_transaction_date: transactionDate,
    status_code: statusCode,
    status_date: transactionDate,
    word_mark: wordMark,
  });

  catalog.recency.push({
    content_revision: 1,
    parser_version: "uspto-projection-v2",
    serial_number: serialNumber,
    snapshot_hash: snapshotHash,
    source_filename: file.filename,
    source_physical_record_index: physicalRecordIndex,
    source_product: file.product,
    source_sha256: file.sha256,
    source_transaction_date: transactionDate,
    updated_at: new Date(`${transactionDate}T12:00:00.000Z`).toISOString(),
  });

  addClassesAndGoods({ catalog, random, serialNumber, source, transactionDate });
  addOwners({ catalog, random, serialNumber, source });
  addStatusEvents({ catalog, filingDate, random, serialNumber, source, transactionDate });
}

/**
 * A mark's transaction date is the day of the file that carried it, never an
 * independent draw. That keeps the mark detail page's source contributor
 * pointing at a real artifact in the Source Status list, and it makes the
 * activity chart show bars only on days a file was actually applied — which is
 * what real ingestion looks like.
 *
 * Recent days are far likelier than old ones, so the catalog's activity piles
 * up in the current week.
 */
function pickSourceFile(input: { files: SeedSourceFile[]; random: SeededRandom }) {
  const { random } = input;
  const baseline = input.files.find((file) => file.applied && file.product !== dailyProduct);

  if (baseline && random.chance(baselineShare)) {
    return baseline;
  }

  // Newest first, then a front-biased draw so the last week dominates.
  const dailies = input.files
    .filter((file) => file.applied && file.product === dailyProduct)
    .sort((left, right) => right.day.localeCompare(left.day));
  if (dailies.length === 0) {
    if (!baseline) {
      throw new Error("The dev seed has no applied source file to attribute marks to.");
    }
    return baseline;
  }

  // "Recent" is a calendar window, not a file count: days without an applied
  // file must not push the week's activity back into last month.
  const [newest] = dailies;
  if (!newest) {
    throw new Error("The dev seed has no applied daily source file.");
  }
  const weekStart = dayLabel(shiftDays(new Date(newest.day), -(recentActivityDays - 1)));
  const thisWeek = dailies.filter((file) => file.day >= weekStart);

  return thisWeek.length > 0 && random.chance(recentActivityShare)
    ? random.pick(thisWeek)
    : random.weighted(dailies, recentDrawExponent);
}

function pickFilingDate(input: { now: Date; random: SeededRandom; transactionDate: string }) {
  const { now, random, transactionDate } = input;
  const ageDays = random.chance(recentFilingShare)
    ? random.int(1, 29)
    : random.int(newestBacklogFilingDays, oldestFilingDays);
  const filingDate = dayLabel(shiftDays(now, -ageDays));
  return filingDate <= transactionDate ? filingDate : transactionDate;
}

function pickStatusCode(random: SeededRandom, forceLive: boolean) {
  if (forceLive) {
    return random.pick(liveStatusCodes);
  }
  const roll = random.next();
  if (roll < liveShare) {
    return random.pick(liveStatusCodes);
  }
  return roll < deadShare ? random.pick(deadStatusCodes) : random.pick(unknownStatusCodes);
}

/**
 * Word marks crowd on purpose. Each single-token showcase mark gets several
 * serials, so exact-match counts are plural; the rest combine the same tokens,
 * so partial and Split searches find neighbours rather than one lonely row.
 */
function buildWordMarks(markCount: number, random: SeededRandom) {
  const wordMarks: string[] = [];

  for (const solo of soloMarks) {
    const repeats = random.int(soloRepeatMin, soloRepeatMax);
    for (let index = 0; index < repeats; index += 1) {
      wordMarks.push(solo);
    }
  }

  while (wordMarks.length < markCount) {
    wordMarks.push(buildCombinedWordMark(random));
  }

  return wordMarks.slice(0, markCount);
}

function buildCombinedWordMark(random: SeededRandom) {
  const roll = random.next();
  if (roll < 0.3) {
    return `${random.pick(themeWords)} ${random.pick(subjectWords)}`;
  }
  if (roll < 0.55) {
    return `${random.pick(themeWords)} ${random.pick(toneWords)}`;
  }
  if (roll < 0.8) {
    return `${random.pick(subjectWords)} ${random.pick(toneWords)}`;
  }
  return `${random.pick(soloMarks)} ${random.pick(toneWords)}`;
}

/** Eight-digit serials in the current 98/99 series, unique across the run. */
function buildSerialNumbers(markCount: number, random: SeededRandom) {
  const serials = new Set<string>();
  while (serials.size < markCount) {
    serials.add(`9${random.int(8, 9)}${String(random.int(0, 999_999)).padStart(6, "0")}`);
  }
  return [...serials].sort();
}

/** Seven-digit registration numbers; the column is uniquely indexed. */
function buildRegistrationNumbers(markCount: number, random: SeededRandom) {
  const numbers = new Set<string>();
  while (numbers.size < markCount) {
    numbers.add(String(random.int(6_000_000, 7_999_999)));
  }
  return [...numbers];
}
