import type postgres from "postgres";

import {
  type MarkClass,
  type MarkGoodsServices,
  type MarkOwner,
  type MarkStatusEvent,
  type MarkType,
  markVersions,
  type ProjectedMark,
} from "../ingestion/mark-types.ts";
import { markTypeSql } from "./mark-page.ts";

type Database = postgres.Sql | postgres.TransactionSql;
type MarkRow = ProjectedMark["mark"] & {
  sourceParserVersion: string;
  sourcePhysicalRecordIndex: number;
  sourceProduct: string;
  sourceSha256: string;
  type: MarkType;
};

const markColumns = `
  m.serial_number as "serialNumber", m.registration_number as "registrationNumber",
  m.word_mark as "wordMark", m.mark_drawing_code as "markDrawingCode", m.filing_date::text as "filingDate",
  m.registration_date::text as "registrationDate", m.status_code as "statusCode", m.status_date::text as "statusDate",
  m.source_transaction_date::text as "sourceTransactionDate", m.source_product as "sourceProduct",
  m.source_sha256 as "sourceSha256", m.source_parser_version as "sourceParserVersion",
  m.source_physical_record_index as "sourcePhysicalRecordIndex", ${markTypeSql} as type`;

async function readMark(
  database: Database,
  identity: { registrationNumber?: string; serialNumber?: string }
) {
  let rows: MarkRow[];
  if (identity.serialNumber) {
    rows = await database.unsafe<MarkRow[]>(
      `select ${markColumns} from mark m where m.serial_number = $1`,
      [identity.serialNumber]
    );
  } else {
    rows = await database.unsafe<MarkRow[]>(
      `select ${markColumns} from mark m where m.registration_number = $1`,
      [identity.registrationNumber ?? ""]
    );
  }
  const [mark] = rows;
  if (!mark) {
    return null;
  }
  const classes = await database<MarkClass[]>`
    select international_code as "internationalCode", status_code as "statusCode", status_date::text as "statusDate"
    from mark_class where serial_number = ${mark.serialNumber} order by ordinal`;
  const goodsServices = await database<MarkGoodsServices[]>`
    select type_code as "typeCode", text from mark_goods_services
    where serial_number = ${mark.serialNumber} order by ordinal`;
  const owners = await database<MarkOwner[]>`
    select entry_number as "entryNumber", party_name as "partyName", party_type as "partyType" from mark_owner
    where serial_number = ${mark.serialNumber} order by ordinal`;
  const statusEvents = await database<MarkStatusEvent[]>`
    select code, event_date::text as date, description, event_number as number, type from mark_status_event
    where serial_number = ${mark.serialNumber} order by event_date, event_key`;
  const {
    sourceParserVersion,
    sourcePhysicalRecordIndex,
    sourceProduct,
    sourceSha256,
    type,
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
    type,
    versions: { ...markVersions, projection: sourceParserVersion },
  } satisfies ProjectedMark & { type: MarkType };
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
