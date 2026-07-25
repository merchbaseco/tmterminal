import type postgres from "postgres";

import { legalDisclaimer, type MarkDetail, type MarksService } from "../api/contracts.ts";
import type { ProjectedMark } from "../ingestion/mark-types.ts";
import { listMarks } from "../queries/list-marks.ts";
import { createMarkRepository } from "../queries/mark-repository.ts";
import { screenQueries } from "../queries/screen.ts";
import { searchMarks } from "../queries/search.ts";
import { matchTexts } from "../queries/text-matches.ts";
import { markStatusForCode } from "../search/status-policy.ts";

export function createMarksService(database: postgres.Sql): MarksService {
  const repository = createMarkRepository(database);

  function publicMark(materialization: ProjectedMark & { type: MarkDetail["type"] }): MarkDetail {
    const { contributors, kind: _kind, versions, ...mark } = materialization;
    return {
      ...mark,
      legalDisclaimer,
      mark: { ...mark.mark, status: markStatusForCode(mark.mark.statusCode) },
      provenance: { contributors, versions },
    };
  }

  return {
    async get(identity) {
      const materialization =
        "serialNumber" in identity
          ? await repository.read(identity.serialNumber)
          : await repository.readByRegistrationNumber(identity.registrationNumber);
      return materialization ? publicMark(materialization) : null;
    },
    list: (input) => listMarks(database, input),
    match: (input) => matchTexts(database, input),
    screen: (input) => screenQueries(database, input),
    search: (input) => searchMarks(database, input),
  };
}
