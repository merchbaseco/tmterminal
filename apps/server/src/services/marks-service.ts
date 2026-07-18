import type postgres from "postgres";

import { legalDisclaimer, type MarkDetail, type MarksService } from "../api/contracts.ts";
import type { ProjectedMark } from "../ingestion/mark-types.ts";
import { createMarkRepository } from "../queries/mark-repository.ts";
import { searchMarks } from "../queries/search.ts";

export function createMarksService(database: postgres.Sql): MarksService {
  const repository = createMarkRepository(database);

  function publicMark(materialization: ProjectedMark): MarkDetail {
    const { contributors, kind: _kind, versions, ...mark } = materialization;
    return {
      ...mark,
      legalDisclaimer,
      provenance: { contributors, versions },
    };
  }

  return {
    async getByRegistrationNumber(registrationNumber: string) {
      const materialization = await repository.readByRegistrationNumber(registrationNumber);
      return materialization ? publicMark(materialization) : null;
    },
    async getBySerialNumber(serialNumber: string) {
      const materialization = await repository.read(serialNumber);
      return materialization ? publicMark(materialization) : null;
    },
    search: (input) => searchMarks(database, input),
  };
}
