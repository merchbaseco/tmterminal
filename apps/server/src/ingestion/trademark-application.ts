import type postgres from "postgres";

import { markVersions } from "./mark-types.ts";
import type {
  MarkUpsertProjection,
  ProjectionBatchResult,
  TrademarkProjection,
} from "./trademark-projection.ts";

type Database = postgres.TransactionSql;
const parserVersionPattern = /-v(\d+)$/;
const childInsertBatchSize = 250;
const legacySnapshotHash = "0".repeat(64);

interface RecencyRow {
  contentRevision: number;
  parserVersion: string;
  serialNumber: string;
  snapshotHash: string;
  sourceFilename: string;
  sourcePhysicalRecordIndex: number;
  sourceProduct: string;
  sourceSha256: string;
  sourceTransactionDate: string;
}

interface CorrectedObservation {
  contentRevision: number;
  parserVersion: string;
  serialNumber: string;
  sourceFilename: string;
  sourcePhysicalRecordIndex: number;
  sourceProduct: string;
  sourceSha256: string;
  sourceTransactionDate: string;
}

export async function applyTrademarkBatch(
  database: Database,
  batch: TrademarkProjection[],
  now: Date
): Promise<ProjectionBatchResult> {
  if (batch.length === 0) {
    return emptyResult();
  }
  const existing = await database<RecencyRow[]>`
    select serial_number as "serialNumber", source_transaction_date::text as "sourceTransactionDate",
      source_product as "sourceProduct", source_filename as "sourceFilename",
      content_revision as "contentRevision", source_sha256 as "sourceSha256",
      source_physical_record_index as "sourcePhysicalRecordIndex",
      parser_version as "parserVersion", snapshot_hash as "snapshotHash"
    from trademark_recency where serial_number in ${database(
      batch.map((projection) => projection.serialNumber)
    )}
  `;
  const recencyBySerial = new Map(existing.map((row) => [row.serialNumber, row]));
  const storedMarks = await database<CorrectedObservation[]>`
    select serial_number as "serialNumber", source_product as "sourceProduct",
      source_filename as "sourceFilename", source_content_revision as "contentRevision",
      source_sha256 as "sourceSha256",
      source_physical_record_index as "sourcePhysicalRecordIndex",
      source_parser_version as "parserVersion",
      source_transaction_date::text as "sourceTransactionDate"
    from mark where serial_number in ${database(batch.map((projection) => projection.serialNumber))}
  `;
  const storedMarkBySerial = new Map(storedMarks.map((row) => [row.serialNumber, row]));
  const acceptedBySerial = new Map<string, TrademarkProjection>();
  const acceptedUpsertsBySerial = new Map<string, MarkUpsertProjection & { kind: "upsert" }>();
  const correctedObservationsBySerial = new Map<string, CorrectedObservation>();
  const ignoredUpsertsBySerial = new Map<string, MarkUpsertProjection & { kind: "upsert" }>();
  let appliedRecordCount = 0;
  let firstError: string | null = null;
  let unresolvedRecordCount = 0;

  for (const projection of batch) {
    const current = recencyBySerial.get(projection.serialNumber);
    const decision = precedence(current, projection);
    if (decision === "conflict") {
      firstError ??= `Equal-date source conflict for serial ${projection.serialNumber}`;
      unresolvedRecordCount += 1;
      continue;
    }
    const storedMark = storedMarkBySerial.get(projection.serialNumber);
    retainIgnoredTrackedEvidence(decision, projection, storedMark, ignoredUpsertsBySerial);
    if (decision === "ignore" && storedMark && isSourceCorrection(storedMark, projection)) {
      appliedRecordCount += 1;
      if (projection.kind === "upsert") {
        acceptedUpsertsBySerial.set(projection.serialNumber, projection);
      } else {
        correctedObservationsBySerial.set(projection.serialNumber, storedMark);
      }
      continue;
    }
    appliedRecordCount += 1;
    if (decision === "replace") {
      acceptedBySerial.set(projection.serialNumber, projection);
      recencyBySerial.set(projection.serialNumber, recencyRow(projection));
      if (projection.kind === "upsert") {
        acceptedUpsertsBySerial.set(projection.serialNumber, projection);
        correctedObservationsBySerial.delete(projection.serialNumber);
      } else if (current && isSourceCorrection(current, projection)) {
        acceptedUpsertsBySerial.delete(projection.serialNumber);
        correctedObservationsBySerial.set(projection.serialNumber, {
          contentRevision: current.contentRevision,
          parserVersion: current.parserVersion,
          serialNumber: current.serialNumber,
          sourceFilename: current.sourceFilename,
          sourcePhysicalRecordIndex: current.sourcePhysicalRecordIndex,
          sourceProduct: current.sourceProduct,
          sourceSha256: current.sourceSha256,
          sourceTransactionDate: current.sourceTransactionDate,
        });
      }
    }
  }
  materializeMissingTrackedEvidence(ignoredUpsertsBySerial, acceptedUpsertsBySerial);

  const accepted = [...acceptedBySerial.values()];
  if (accepted.length > 0) {
    await writeRecency(database, accepted, now);
  }
  const removalCount = await removeCorrectedMarks(database, [
    ...correctedObservationsBySerial.values(),
  ]);
  const upserts = [...acceptedUpsertsBySerial.values()];
  const materialChangeCount = removalCount + (await replaceMarks(database, upserts));
  await database`
    insert into data_state (id, version, last_successful_update_at)
    values ('uspto', ${materialChangeCount > 0 ? 1 : 0}, ${now})
    on conflict (id) do update set
      version = data_state.version + ${materialChangeCount > 0 ? 1 : 0},
      last_successful_update_at = excluded.last_successful_update_at
  `;
  return {
    appliedRecordCount,
    firstError,
    materialChangeCount,
    unresolvedRecordCount,
  };
}

function recencyRow(projection: TrademarkProjection): RecencyRow {
  return {
    contentRevision: projection.coordinate.contentRevision,
    parserVersion: projection.coordinate.parserVersion,
    serialNumber: projection.serialNumber,
    snapshotHash: projection.snapshotHash,
    sourceFilename: projection.coordinate.filename,
    sourcePhysicalRecordIndex: projection.coordinate.physicalRecordIndex,
    sourceProduct: projection.coordinate.product,
    sourceSha256: projection.coordinate.sha256,
    sourceTransactionDate: projection.sourceTransactionDate,
  };
}

function materializeMissingTrackedEvidence(
  ignoredUpsertsBySerial: Map<string, MarkUpsertProjection & { kind: "upsert" }>,
  acceptedUpsertsBySerial: Map<string, MarkUpsertProjection & { kind: "upsert" }>
) {
  for (const projection of ignoredUpsertsBySerial.values()) {
    if (!acceptedUpsertsBySerial.has(projection.serialNumber)) {
      acceptedUpsertsBySerial.set(projection.serialNumber, projection);
    }
  }
}

function retainIgnoredTrackedEvidence(
  decision: ReturnType<typeof precedence>,
  projection: TrademarkProjection,
  storedMark: CorrectedObservation | undefined,
  ignoredUpsertsBySerial: Map<string, MarkUpsertProjection & { kind: "upsert" }>
) {
  if (
    decision !== "ignore" ||
    projection.kind !== "upsert" ||
    (storedMark && projection.sourceTransactionDate <= storedMark.sourceTransactionDate)
  ) {
    return;
  }
  const previous = ignoredUpsertsBySerial.get(projection.serialNumber);
  if (!previous || precedence(recencyRow(previous), projection) === "replace") {
    ignoredUpsertsBySerial.set(projection.serialNumber, projection);
  }
}

function precedence(existing: RecencyRow | undefined, candidate: TrademarkProjection) {
  if (!existing) {
    return "replace" as const;
  }
  if (candidate.sourceTransactionDate > existing.sourceTransactionDate) {
    return "replace" as const;
  }
  if (candidate.sourceTransactionDate < existing.sourceTransactionDate) {
    return "ignore" as const;
  }
  if (existing.snapshotHash === legacySnapshotHash) {
    return "replace" as const;
  }
  const sameArtifact =
    candidate.coordinate.product === existing.sourceProduct &&
    candidate.coordinate.filename === existing.sourceFilename &&
    candidate.coordinate.contentRevision === existing.contentRevision &&
    candidate.coordinate.sha256 === existing.sourceSha256;
  if (
    sameArtifact &&
    candidate.coordinate.physicalRecordIndex > existing.sourcePhysicalRecordIndex
  ) {
    return "replace" as const;
  }
  if (
    sameArtifact &&
    candidate.coordinate.physicalRecordIndex < existing.sourcePhysicalRecordIndex
  ) {
    return "ignore" as const;
  }
  if (candidate.snapshotHash === existing.snapshotHash) {
    return "ignore" as const;
  }
  const sameCoordinate = isSameCoordinate(existing, candidate);
  if (
    sameCoordinate &&
    parserVersion(candidate.coordinate.parserVersion) > parserVersion(existing.parserVersion)
  ) {
    return "replace" as const;
  }
  if (
    candidate.coordinate.product === existing.sourceProduct &&
    candidate.coordinate.filename === existing.sourceFilename &&
    candidate.coordinate.contentRevision > existing.contentRevision
  ) {
    return "replace" as const;
  }
  return "conflict" as const;
}

function isParserCorrection(existing: CorrectedObservation, candidate: TrademarkProjection) {
  return (
    isSameCoordinate(existing, candidate) &&
    parserVersion(candidate.coordinate.parserVersion) > parserVersion(existing.parserVersion)
  );
}

function isSourceCorrection(existing: CorrectedObservation, candidate: TrademarkProjection) {
  return (
    isParserCorrection(existing, candidate) ||
    (candidate.coordinate.product === existing.sourceProduct &&
      candidate.coordinate.filename === existing.sourceFilename &&
      candidate.coordinate.contentRevision > existing.contentRevision)
  );
}

function isSameCoordinate(existing: CorrectedObservation, candidate: TrademarkProjection) {
  return (
    candidate.coordinate.product === existing.sourceProduct &&
    candidate.coordinate.filename === existing.sourceFilename &&
    candidate.coordinate.contentRevision === existing.contentRevision &&
    candidate.coordinate.sha256 === existing.sourceSha256 &&
    candidate.coordinate.physicalRecordIndex === existing.sourcePhysicalRecordIndex
  );
}

function parserVersion(value: string) {
  const match = parserVersionPattern.exec(value);
  return match ? Number(match[1]) : 0;
}

function writeRecency(database: Database, projections: TrademarkProjection[], now: Date) {
  return database`
    insert into trademark_recency ${database(
      projections.map((projection) => ({
        content_revision: projection.coordinate.contentRevision,
        parser_version: projection.coordinate.parserVersion,
        serial_number: projection.serialNumber,
        snapshot_hash: projection.snapshotHash,
        source_filename: projection.coordinate.filename,
        source_physical_record_index: projection.coordinate.physicalRecordIndex,
        source_product: projection.coordinate.product,
        source_sha256: projection.coordinate.sha256,
        source_transaction_date: projection.sourceTransactionDate,
        updated_at: now,
      }))
    )}
    on conflict (serial_number) do update set
      content_revision = excluded.content_revision,
      parser_version = excluded.parser_version,
      snapshot_hash = excluded.snapshot_hash,
      source_filename = excluded.source_filename,
      source_physical_record_index = excluded.source_physical_record_index,
      source_product = excluded.source_product,
      source_sha256 = excluded.source_sha256,
      source_transaction_date = excluded.source_transaction_date,
      updated_at = excluded.updated_at
  `;
}

async function removeCorrectedMarks(database: Database, corrections: CorrectedObservation[]) {
  if (corrections.length === 0) {
    return 0;
  }
  const marks = await database<CorrectedObservation[]>`
    select serial_number as "serialNumber", source_product as "sourceProduct",
      source_filename as "sourceFilename", source_content_revision as "contentRevision",
      source_sha256 as "sourceSha256",
      source_physical_record_index as "sourcePhysicalRecordIndex",
      source_parser_version as "parserVersion",
      source_transaction_date::text as "sourceTransactionDate"
    from mark where serial_number in ${database(corrections.map(({ serialNumber }) => serialNumber))}
  `;
  const correctionBySerial = new Map(corrections.map((item) => [item.serialNumber, item]));
  const serials = marks
    .filter((mark) => {
      const correction = correctionBySerial.get(mark.serialNumber);
      return correction ? isSameStoredCoordinate(mark, correction) : false;
    })
    .map(({ serialNumber }) => serialNumber);
  if (serials.length === 0) {
    return 0;
  }
  const removed = await database<Array<{ serialNumber: string }>>`
    delete from mark where serial_number in ${database(serials)}
    returning serial_number as "serialNumber"
  `;
  return removed.length;
}

function isSameStoredCoordinate(left: CorrectedObservation, right: CorrectedObservation) {
  return (
    left.serialNumber === right.serialNumber &&
    left.sourceProduct === right.sourceProduct &&
    left.sourceFilename === right.sourceFilename &&
    left.contentRevision === right.contentRevision &&
    left.sourceSha256 === right.sourceSha256 &&
    left.sourcePhysicalRecordIndex === right.sourcePhysicalRecordIndex &&
    left.parserVersion === right.parserVersion
  );
}

async function replaceMarks(database: Database, projections: MarkUpsertProjection[]) {
  if (projections.length === 0) {
    return 0;
  }
  const source = (projection: MarkUpsertProjection) => ({
    source_filename: projection.coordinate.filename,
    source_physical_record_index: projection.coordinate.physicalRecordIndex,
    source_product: projection.coordinate.product,
    source_sha256: projection.coordinate.sha256,
  });
  await database`
    insert into mark ${database(
      projections.map((projection) => ({
        filing_date: projection.filingDate,
        mark_drawing_code: projection.markDrawingCode,
        normalization_version: markVersions.normalization,
        registration_date: projection.registrationDate,
        registration_number: projection.registrationNumber,
        serial_number: projection.serialNumber,
        source_content_revision: projection.coordinate.contentRevision,
        source_parser_version: projection.coordinate.parserVersion,
        source_snapshot_hash: projection.snapshotHash,
        source_transaction_date: projection.sourceTransactionDate,
        status_code: projection.statusCode,
        status_date: projection.statusDate,
        word_mark: projection.wordMark,
        ...source(projection),
      }))
    )}
    on conflict (serial_number) do update set
      filing_date = excluded.filing_date,
      mark_drawing_code = excluded.mark_drawing_code,
      normalization_version = excluded.normalization_version,
      registration_date = excluded.registration_date,
      registration_number = excluded.registration_number,
      source_content_revision = excluded.source_content_revision,
      source_filename = excluded.source_filename,
      source_parser_version = excluded.source_parser_version,
      source_physical_record_index = excluded.source_physical_record_index,
      source_product = excluded.source_product,
      source_sha256 = excluded.source_sha256,
      source_snapshot_hash = excluded.source_snapshot_hash,
      source_transaction_date = excluded.source_transaction_date,
      status_code = excluded.status_code,
      status_date = excluded.status_date,
      word_mark = excluded.word_mark
  `;
  const serials = projections.map((projection) => projection.serialNumber);
  await database`delete from mark_class where serial_number in ${database(serials)}`;
  await database`delete from mark_owner where serial_number in ${database(serials)}`;
  await database`delete from mark_goods_services where serial_number in ${database(serials)}`;
  await database`delete from mark_status_event where serial_number in ${database(serials)}`;

  const classes = projections.flatMap((projection) =>
    projection.classes.map((item, index) => ({
      international_code: item.internationalCode,
      ordinal: index + 1,
      serial_number: projection.serialNumber,
      status_code: item.statusCode,
      status_date: item.statusDate,
      ...source(projection),
    }))
  );
  const owners = projections.flatMap((projection) =>
    projection.owners.map((item, index) => ({
      entry_number: item.entryNumber,
      ordinal: index + 1,
      party_name: item.partyName,
      party_type: item.partyType,
      serial_number: projection.serialNumber,
      ...source(projection),
    }))
  );
  const goods = projections.flatMap((projection) =>
    projection.goodsServices.map((item, index) => ({
      ordinal: index + 1,
      serial_number: projection.serialNumber,
      text: item.text,
      type_code: item.typeCode,
      ...source(projection),
    }))
  );
  const events = projections.flatMap((projection) =>
    projection.statusEvents.map((item) => ({
      code: item.code,
      description: item.description,
      event_date: item.date,
      event_key: item.eventKey,
      event_number: item.number,
      serial_number: projection.serialNumber,
      type: item.type,
      ...source(projection),
    }))
  );
  for (let offset = 0; offset < classes.length; offset += childInsertBatchSize) {
    // biome-ignore lint/performance/noAwaitInLoops: Child collection statements are deliberately bounded.
    await database`insert into mark_class ${database(
      classes.slice(offset, offset + childInsertBatchSize)
    )}`;
  }
  for (let offset = 0; offset < owners.length; offset += childInsertBatchSize) {
    // biome-ignore lint/performance/noAwaitInLoops: Child collection statements are deliberately bounded.
    await database`insert into mark_owner ${database(
      owners.slice(offset, offset + childInsertBatchSize)
    )}`;
  }
  for (let offset = 0; offset < goods.length; offset += childInsertBatchSize) {
    // biome-ignore lint/performance/noAwaitInLoops: Child collection statements are deliberately bounded.
    await database`insert into mark_goods_services ${database(
      goods.slice(offset, offset + childInsertBatchSize)
    )}`;
  }
  for (let offset = 0; offset < events.length; offset += childInsertBatchSize) {
    // biome-ignore lint/performance/noAwaitInLoops: Child collection statements are deliberately bounded.
    await database`insert into mark_status_event ${database(
      events.slice(offset, offset + childInsertBatchSize)
    )}`;
  }
  return projections.length;
}

function emptyResult(): ProjectionBatchResult {
  return {
    appliedRecordCount: 0,
    firstError: null,
    materialChangeCount: 0,
    unresolvedRecordCount: 0,
  };
}
