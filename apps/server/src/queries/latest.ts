import type postgres from "postgres";

import type { LatestInput, MarkPage } from "../api/contracts.ts";
import { assertDataVersion, readDataSnapshot } from "./data-snapshot.ts";
import { markSummarySql } from "./mark-page.ts";

export function latestMarks(database: postgres.Sql, input: LatestInput): Promise<MarkPage> {
  return database.begin("isolation level repeatable read read only", async (transaction) => {
    const snapshot = await readDataSnapshot(transaction);
    assertDataVersion(snapshot, input.expectedDataVersion);

    const [count] = await transaction<Array<{ total: number }>>`
      select count(*)::int as total from mark where source_transaction_date is not null
    `;
    if (!count) {
      throw new Error("Latest activity count query returned no row");
    }
    const items = await transaction.unsafe<MarkPage["items"]>(
      `select ${markSummarySql}
      from mark m
      where m.source_transaction_date is not null
      order by m.source_transaction_date desc, m.serial_number
      limit $1 offset $2`,
      [input.limit, input.offset]
    );

    return {
      items,
      limit: input.limit,
      meta: snapshot,
      offset: input.offset,
      total: count.total,
    };
  });
}
