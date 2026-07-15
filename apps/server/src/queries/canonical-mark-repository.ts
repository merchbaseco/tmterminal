import { createHash } from "node:crypto";
import type postgres from "postgres";

import type {
  CanonicalClass,
  CanonicalGoodsServices,
  CanonicalOwner,
  CanonicalStatusEvent,
  Contributor,
  ResolvedCanonicalMark,
} from "../ingestion/canonical-marks.ts";

type MarkRow = ResolvedCanonicalMark["mark"] & {
  authorityPolicy: string;
  normalization: string;
  projection: string;
  sourceProfile: string;
};

function eventKey(event: CanonicalStatusEvent) {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

export function createCanonicalMarkRepository(database: postgres.Sql) {
  return {
    // PRD-59 replay reads are quiescent; publication-consistent concurrent reads belong to PRD-63.
    async read(serialNumber: string): Promise<ResolvedCanonicalMark | null> {
      const [mark] = await database<MarkRow[]>`
        select serial_number as "serialNumber", registration_number as "registrationNumber",
          word_mark as "wordMark", mark_drawing_code as "markDrawingCode", filing_date::text as "filingDate",
          registration_date::text as "registrationDate", status_code as "statusCode", status_date::text as "statusDate",
          source_transaction_date::text as "sourceTransactionDate", normalization_version as normalization,
          source_profile_version as "sourceProfile", projection_version as projection,
          authority_policy_version as "authorityPolicy"
        from mark where serial_number = ${serialNumber}
      `;
      if (!mark) return null;
      const classes = await database<CanonicalClass[]>`
        select international_code as "internationalCode", status_code as "statusCode", status_date::text as "statusDate"
        from mark_class where serial_number = ${serialNumber} order by ordinal
      `;
      const goodsServices = await database<CanonicalGoodsServices[]>`
        select type_code as "typeCode", text
        from mark_goods_services where serial_number = ${serialNumber} order by ordinal
      `;
      const owners = await database<CanonicalOwner[]>`
        select entry_number as "entryNumber", party_name as "partyName", party_type as "partyType"
        from mark_owner where serial_number = ${serialNumber} order by ordinal
      `;
      const statusEvents = await database<CanonicalStatusEvent[]>`
        select code, event_date::text as date, description, event_number as number, type
        from mark_status_event where serial_number = ${serialNumber}
      `;
      const contributors = await database<Contributor[]>`
        select artifact_version_sha256 as "artifactVersionSha256", claim_path as "claimPath", group_name as "group",
          physical_record_index as "physicalRecordIndex", product
        from mark_group_contributor where serial_number = ${serialNumber}
        order by group_name, claim_path, product, artifact_version_sha256, physical_record_index
      `;
      const { authorityPolicy, normalization, projection, sourceProfile, ...canonicalMark } = mark;
      return {
        classes,
        contributors,
        goodsServices,
        kind: "resolved",
        mark: canonicalMark,
        owners,
        statusEvents: statusEvents.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        versions: { authorityPolicy, normalization, projection, sourceProfile } as ResolvedCanonicalMark["versions"],
      };
    },

    async replace(materialization: ResolvedCanonicalMark): Promise<void> {
      const { mark, versions } = materialization;
      await database.begin(async (transaction) => {
        await transaction`
          insert into mark (
            serial_number, registration_number, word_mark, mark_drawing_code, filing_date, registration_date,
            status_code, status_date, source_transaction_date, normalization_version, source_profile_version,
            projection_version, authority_policy_version
          ) values (
            ${mark.serialNumber}, ${mark.registrationNumber}, ${mark.wordMark}, ${mark.markDrawingCode}, ${mark.filingDate},
            ${mark.registrationDate}, ${mark.statusCode}, ${mark.statusDate}, ${mark.sourceTransactionDate},
            ${versions.normalization}, ${versions.sourceProfile}, ${versions.projection}, ${versions.authorityPolicy}
          )
          on conflict (serial_number) do update set
            registration_number = excluded.registration_number,
            word_mark = excluded.word_mark,
            mark_drawing_code = excluded.mark_drawing_code,
            filing_date = excluded.filing_date,
            registration_date = excluded.registration_date,
            status_code = excluded.status_code,
            status_date = excluded.status_date,
            source_transaction_date = excluded.source_transaction_date,
            normalization_version = excluded.normalization_version,
            source_profile_version = excluded.source_profile_version,
            projection_version = excluded.projection_version,
            authority_policy_version = excluded.authority_policy_version
        `;
        await transaction`delete from mark_class where serial_number = ${mark.serialNumber}`;
        await transaction`delete from mark_goods_services where serial_number = ${mark.serialNumber}`;
        await transaction`delete from mark_owner where serial_number = ${mark.serialNumber}`;
        await transaction`delete from mark_status_event where serial_number = ${mark.serialNumber}`;
        await transaction`delete from mark_group_contributor where serial_number = ${mark.serialNumber}`;

        if (materialization.classes.length > 0) {
          await transaction`
            insert into mark_class ${transaction(materialization.classes.map((item, index) => ({
              serial_number: mark.serialNumber,
              ordinal: index + 1,
              international_code: item.internationalCode,
              status_code: item.statusCode,
              status_date: item.statusDate,
            })))}
          `;
        }
        if (materialization.goodsServices.length > 0) {
          await transaction`
            insert into mark_goods_services ${transaction(materialization.goodsServices.map((item, index) => ({
              serial_number: mark.serialNumber,
              ordinal: index + 1,
              type_code: item.typeCode,
              text: item.text,
            })))}
          `;
        }
        if (materialization.owners.length > 0) {
          await transaction`
            insert into mark_owner ${transaction(materialization.owners.map((item, index) => ({
              serial_number: mark.serialNumber,
              ordinal: index + 1,
              entry_number: item.entryNumber,
              party_name: item.partyName,
              party_type: item.partyType,
            })))}
          `;
        }
        if (materialization.statusEvents.length > 0) {
          await transaction`
            insert into mark_status_event ${transaction(materialization.statusEvents.map((item) => ({
              serial_number: mark.serialNumber,
              event_key: eventKey(item),
              code: item.code,
              type: item.type,
              description: item.description,
              event_date: item.date,
              event_number: item.number,
            })))}
          `;
        }
        if (materialization.contributors.length > 0) {
          await transaction`
            insert into mark_group_contributor ${transaction(materialization.contributors.map((item) => ({
              serial_number: mark.serialNumber,
              group_name: item.group,
              claim_path: item.claimPath,
              product: item.product,
              artifact_version_sha256: item.artifactVersionSha256,
              physical_record_index: item.physicalRecordIndex,
            })))}
          `;
        }
      });
    },
  };
}
