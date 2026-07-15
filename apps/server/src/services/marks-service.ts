import type postgres from "postgres";

import {
  legalDisclaimer,
  type MarkDetail,
  type MarksService,
} from "../api/contracts.ts";
import type { ResolvedCanonicalMark } from "../ingestion/canonical-mark-types.ts";
import { createCanonicalMarkRepository } from "../queries/canonical-mark-repository.ts";

export function createMarksService(database: postgres.Sql): MarksService {
  const repository = createCanonicalMarkRepository(database);

  function publicMark(materialization: ResolvedCanonicalMark): MarkDetail {
    const { contributors, kind: _kind, versions, ...mark } = materialization;
    return {
      ...mark,
      legalDisclaimer,
      provenance: { contributors, versions },
    };
  }

  return {
    async getBySerialNumber(serialNumber: string) {
      const materialization = await repository.read(serialNumber);
      return materialization ? publicMark(materialization) : null;
    },
    async getByRegistrationNumber(registrationNumber: string) {
      const materialization = await repository.readByRegistrationNumber(registrationNumber);
      return materialization ? publicMark(materialization) : null;
    },
  };
}
