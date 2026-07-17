import type postgres from "postgres";

import type { OperatorArtifact, OperatorPageInput } from "../api/contracts.ts";

type ArtifactRow = Omit<OperatorArtifact, "bytes" | "completedAt" | "updatedAt"> & {
  bytes: string | null;
  completedAt: Date | null;
  updatedAt: Date;
};

export async function readOperatorArtifacts(
  database: postgres.Sql | postgres.TransactionSql,
  input: OperatorPageInput
) {
  const [count] = await database<
    Array<{ total: number }>
  >`select count(*)::int as total from source_artifact`;
  const items = await database<ArtifactRow[]>`
    select id as "artifactId", bytes::text, completed_at as "completedAt", current_error as "currentError",
      filename, physical_record_count as "physicalRecordCount", product,
      projected_mark_count as "projectedMarkCount", sha256, source_from_date::text as "sourceFromDate",
      source_to_date::text as "sourceToDate", state, updated_at as "updatedAt"
    from source_artifact order by filename limit ${input.limit} offset ${input.offset}
  `;
  return { items, total: count?.total ?? 0 };
}
