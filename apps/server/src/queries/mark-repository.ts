import type postgres from "postgres";

import {
  type MarkClass,
  type MarkGoodsServices,
  type MarkOwner,
  type MarkStatusEvent,
  markVersions,
  type ProjectedMark,
} from "../ingestion/mark-types.ts";
import { CorpusUnavailableError } from "./corpus-errors.ts";

type Database = postgres.Sql | postgres.TransactionSql;
type MarkRow = ProjectedMark["mark"] & {
  generationId: string;
  sourcePhysicalRecordIndex: number;
  sourceProduct: string;
  sourceSha256: string;
};

async function readMark(
  database: Database,
  identity: { registrationNumber?: string; serialNumber?: string }
) {
  const [state] = await database<Array<{ generationId: string | null }>>`
    select current_generation_id as "generationId" from corpus_state where id = 'uspto'
  `;
  if (!state?.generationId) {
    throw new CorpusUnavailableError("Trademark corpus is unavailable");
  }
  let rows: MarkRow[];
  if (identity.serialNumber) {
    rows = await database<MarkRow[]>`
        select m.generation_id as "generationId", m.serial_number as "serialNumber", m.registration_number as "registrationNumber",
          m.word_mark as "wordMark", m.mark_drawing_code as "markDrawingCode", m.filing_date::text as "filingDate",
          m.registration_date::text as "registrationDate", m.status_code as "statusCode", m.status_date::text as "statusDate",
          m.source_transaction_date::text as "sourceTransactionDate", m.source_product as "sourceProduct",
          m.source_sha256 as "sourceSha256", m.source_physical_record_index as "sourcePhysicalRecordIndex"
        from mark m where m.generation_id = ${state.generationId}
          and m.serial_number = ${identity.serialNumber}`;
  } else {
    rows = await database<MarkRow[]>`
        select m.generation_id as "generationId", m.serial_number as "serialNumber", m.registration_number as "registrationNumber",
          m.word_mark as "wordMark", m.mark_drawing_code as "markDrawingCode", m.filing_date::text as "filingDate",
          m.registration_date::text as "registrationDate", m.status_code as "statusCode", m.status_date::text as "statusDate",
          m.source_transaction_date::text as "sourceTransactionDate", m.source_product as "sourceProduct",
          m.source_sha256 as "sourceSha256", m.source_physical_record_index as "sourcePhysicalRecordIndex"
        from mark m where m.generation_id = ${state.generationId}
          and m.registration_number = ${identity.registrationNumber ?? ""}`;
  }
  const [mark] = rows;
  if (!mark) {
    return null;
  }
  const classes = await database<MarkClass[]>`
    select international_code as "internationalCode", status_code as "statusCode", status_date::text as "statusDate"
    from mark_class where generation_id = ${mark.generationId} and serial_number = ${mark.serialNumber} order by ordinal`;
  const goodsServices = await database<MarkGoodsServices[]>`
    select type_code as "typeCode", text from mark_goods_services
    where generation_id = ${mark.generationId} and serial_number = ${mark.serialNumber} order by ordinal`;
  const owners = await database<MarkOwner[]>`
    select entry_number as "entryNumber", party_name as "partyName", party_type as "partyType" from mark_owner
    where generation_id = ${mark.generationId} and serial_number = ${mark.serialNumber} order by ordinal`;
  const statusEvents = await database<MarkStatusEvent[]>`
    select code, event_date::text as date, description, event_number as number, type from mark_status_event
    where generation_id = ${mark.generationId} and serial_number = ${mark.serialNumber} order by event_date, event_key`;
  const {
    generationId: _generationId,
    sourcePhysicalRecordIndex,
    sourceProduct,
    sourceSha256,
    ...publicMark
  } = mark;
  return {
    classes,
    contributors: [
      {
        artifactVersionSha256: sourceSha256,
        claimPath: "case-file",
        group: "mark-presentation" as const,
        physicalRecordIndex: sourcePhysicalRecordIndex,
        product: sourceProduct,
      },
    ],
    goodsServices,
    kind: "resolved" as const,
    mark: publicMark,
    owners,
    statusEvents,
    versions: markVersions,
  } satisfies ProjectedMark;
}

export function createMarkRepository(database: postgres.Sql) {
  const snapshot = <T>(work: (transaction: Database) => Promise<T>) =>
    database.begin("isolation level repeatable read read only", work);
  return {
    read: (serialNumber: string) =>
      snapshot((transaction) => readMark(transaction, { serialNumber })),
    readByRegistrationNumber: (registrationNumber: string) =>
      snapshot((transaction) => readMark(transaction, { registrationNumber })),
  };
}
