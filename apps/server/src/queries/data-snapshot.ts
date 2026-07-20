import type postgres from "postgres";

export interface DataSnapshot {
  dataThroughDate: string | null;
  dataVersion: string;
}

export class DataVersionConflictError extends Error {}

export async function readDataSnapshot(
  transaction: postgres.TransactionSql
): Promise<DataSnapshot> {
  const [snapshot] = await transaction<DataSnapshot[]>`
    select state.complete_through_date::text as "dataThroughDate",
      coalesce(state.version, 0)::text as "dataVersion"
    from (select 1) anchor left join data_state state on state.id = 'uspto'
  `;
  if (!snapshot) {
    throw new Error("Trademark data state is unavailable");
  }
  return snapshot;
}

export function assertDataVersion(snapshot: DataSnapshot, expectedDataVersion?: string) {
  if (expectedDataVersion && expectedDataVersion !== snapshot.dataVersion) {
    throw new DataVersionConflictError("Trademark data changed during pagination");
  }
}
