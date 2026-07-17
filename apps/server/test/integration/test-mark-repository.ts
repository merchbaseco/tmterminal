import { createHash } from "node:crypto";
import type postgres from "postgres";

import type { ProjectedMark } from "../../src/ingestion/mark-types.ts";

export const testGenerationId = "90000000-0000-4000-8000-000000000001";

export function createTestMarkRepository(database: postgres.Sql) {
  return {
    async replace(materialization: ProjectedMark) {
      const { mark } = materialization;
      await database`
        insert into corpus_generation (id, product, from_date, to_date, expected_artifact_count)
        values (${testGenerationId}, 'TRTYRAP', '1884-04-07', '2025-12-31', 91) on conflict do nothing`;
      await database`
        insert into mark (generation_id, serial_number, registration_number, word_mark, mark_drawing_code,
          filing_date, registration_date, status_code, status_date, source_transaction_date,
          normalization_version, source_product, source_filename, source_sha256, source_physical_record_index)
        values (${testGenerationId}, ${mark.serialNumber}, ${mark.registrationNumber}, ${mark.wordMark ?? ""},
          ${mark.markDrawingCode}, ${mark.filingDate}, ${mark.registrationDate}, ${mark.statusCode}, ${mark.statusDate},
          ${mark.sourceTransactionDate}, 'uspto-normalization-v1', 'TRTYRAP', 'test.zip', ${"a".repeat(64)}, 1)
        on conflict (generation_id, serial_number) do update set registration_number = excluded.registration_number,
          word_mark = excluded.word_mark, mark_drawing_code = excluded.mark_drawing_code,
          filing_date = excluded.filing_date, registration_date = excluded.registration_date,
          status_code = excluded.status_code, status_date = excluded.status_date,
          source_transaction_date = excluded.source_transaction_date`;
      await database`delete from mark_class where generation_id = ${testGenerationId} and serial_number = ${mark.serialNumber}`;
      await database`delete from mark_owner where generation_id = ${testGenerationId} and serial_number = ${mark.serialNumber}`;
      await database`delete from mark_goods_services where generation_id = ${testGenerationId} and serial_number = ${mark.serialNumber}`;
      await database`delete from mark_status_event where generation_id = ${testGenerationId} and serial_number = ${mark.serialNumber}`;
      const source = {
        source_filename: "test.zip",
        source_physical_record_index: 1,
        source_product: "TRTYRAP",
        source_sha256: "a".repeat(64),
      };
      if (materialization.classes.length) {
        await database`insert into mark_class ${database(materialization.classes.map((item, index) => ({ generation_id: testGenerationId, international_code: item.internationalCode, ordinal: index + 1, serial_number: mark.serialNumber, status_code: item.statusCode, status_date: item.statusDate, ...source })))}`;
      }
      if (materialization.owners.length) {
        await database`insert into mark_owner ${database(materialization.owners.map((item, index) => ({ entry_number: item.entryNumber, generation_id: testGenerationId, ordinal: index + 1, party_name: item.partyName, party_type: item.partyType, serial_number: mark.serialNumber, ...source })))}`;
      }
      if (materialization.goodsServices.length) {
        await database`insert into mark_goods_services ${database(materialization.goodsServices.map((item, index) => ({ generation_id: testGenerationId, ordinal: index + 1, serial_number: mark.serialNumber, text: item.text, type_code: item.typeCode, ...source })))}`;
      }
      if (materialization.statusEvents.length) {
        await database`insert into mark_status_event ${database(materialization.statusEvents.map((item) => ({ code: item.code, description: item.description, event_date: item.date, event_key: createHash("sha256").update(JSON.stringify(item)).digest("hex"), event_number: item.number, generation_id: testGenerationId, serial_number: mark.serialNumber, type: item.type, ...source })))}`;
      }
    },
  };
}
