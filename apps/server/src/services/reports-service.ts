import type postgres from "postgres";

import type { ReportsService } from "../api/contracts.ts";
import { runReport } from "../queries/reports.ts";

export function createReportsService(database: postgres.Sql): ReportsService {
  return { run: (input) => runReport(database, input) };
}
