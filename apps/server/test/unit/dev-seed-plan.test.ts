import { describe, expect, test } from "bun:test";

import { buildDevSeedPlan, defaultSeedOptions } from "../../src/dev-seed/plan.ts";
import type { DevSeedOptions, DevSeedPlan, SeedRow } from "../../src/dev-seed/types.ts";
import { markStatusForCode } from "../../src/search/status-policy.ts";

/**
 * The coverage contract. The seed exists so a developer can open search, mark
 * detail, screening, and Source Status without hand-building rows, and these
 * assertions are that promise rather than incidental shape checks. A surface
 * that stops being covered should fail here, in the fast lane, rather than as
 * an empty page in a cloud session.
 */

const now = new Date("2026-08-25T19:30:00.000Z");

function buildPlan(overrides: Partial<DevSeedOptions> = {}) {
  return buildDevSeedPlan({ ...defaultSeedOptions, now, ...overrides });
}

function rowsFor(plan: DevSeedPlan, table: string): SeedRow[] {
  return plan.tables.find((entry) => entry.table === table)?.rows ?? [];
}

function markType(drawingCode: unknown) {
  if (drawingCode === "1") {
    return "typeset";
  }
  if (drawingCode === "4") {
    return "text";
  }
  return ["2", "3", "5"].includes(String(drawingCode)) ? "design" : "other";
}

describe("buildDevSeedPlan", () => {
  test("is reproducible for a seed and varied across seeds", () => {
    expect(buildPlan()).toEqual(buildPlan());
    expect(buildPlan({ seed: "friday" })).not.toEqual(buildPlan());
  });

  test("fills every table it plans", () => {
    for (const table of buildPlan().tables) {
      expect(table.rows.length, `${table.table} has no rows`).toBeGreaterThan(0);
    }
  });

  test("seeds a register a developer can actually search", () => {
    const plan = buildPlan();
    const marks = rowsFor(plan, "mark");

    expect(marks.length).toBe(defaultSeedOptions.markCount);

    // Every search filter has both sides to filter between.
    const statuses = new Set(marks.map((row) => markStatusForCode(String(row.status_code))));
    expect(statuses).toEqual(new Set(["live", "dead", "unknown"]));

    const types = new Set(marks.map((row) => markType(row.mark_drawing_code)));
    expect(types).toEqual(new Set(["text", "typeset", "design", "other"]));

    expect(marks.some((row) => row.registration_number !== null)).toBe(true);
    expect(marks.some((row) => row.registration_number === null)).toBe(true);

    // Crowded word families, so exact and partial counts differ.
    const byWordMark = new Map<string, number>();
    for (const mark of marks) {
      const wordMark = String(mark.word_mark);
      byWordMark.set(wordMark, (byWordMark.get(wordMark) ?? 0) + 1);
    }
    expect([...byWordMark.values()].filter((count) => count > 1).length).toBeGreaterThan(5);
    expect(byWordMark.size).toBeGreaterThan(40);
  });

  test("keeps every showcase word mark live and findable", () => {
    const plan = buildPlan();
    const marks = rowsFor(plan, "mark");

    expect(plan.showcaseWordMarks.length).toBeGreaterThan(4);

    for (const wordMark of plan.showcaseWordMarks) {
      const exact = marks.filter((row) => row.word_mark === wordMark);
      expect(exact.length, `${wordMark} has no exact match`).toBeGreaterThan(1);
      expect(
        exact.some((row) => markStatusForCode(String(row.status_code)) === "live"),
        `${wordMark} has no live exact match`
      ).toBe(true);

      // Screening and partial search need neighbours, not just the solo mark.
      expect(
        marks.some((row) => row.word_mark !== wordMark && String(row.word_mark).includes(wordMark)),
        `${wordMark} has no partial neighbour`
      ).toBe(true);
    }
  });

  test("gives every mark the detail the mark page renders", () => {
    const plan = buildPlan();
    const serials = new Set(rowsFor(plan, "mark").map((row) => String(row.serial_number)));

    for (const table of ["mark_class", "mark_owner", "mark_goods_services", "mark_status_event"]) {
      const rows = rowsFor(plan, table);
      expect(rows.length, `${table} is empty`).toBeGreaterThan(0);
      expect(
        rows.every((row) => serials.has(String(row.serial_number))),
        `${table} references a mark that was never planned`
      ).toBe(true);
    }

    const owned = new Set(rowsFor(plan, "mark_owner").map((row) => String(row.serial_number)));
    expect(owned.size).toBe(serials.size);
    expect(rowsFor(plan, "trademark_recency").length).toBe(serials.size);
  });

  test("describes the current week", () => {
    const plan = buildPlan();
    const marks = rowsFor(plan, "mark");
    const days = marks
      .map((row) => String(row.source_transaction_date))
      .sort((left, right) => left.localeCompare(right));

    // The newest activity is the newest applied source file, so Latest
    // Processed and the newest-activity sort agree.
    expect(days.at(-1)).toBe(plan.latestProcessedDate);

    const weekStart = new Date(plan.latestProcessedDate);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const thisWeek = days.filter((day) => day >= weekStart.toISOString().slice(0, 10));
    expect(thisWeek.length / marks.length).toBeGreaterThan(0.45);

    // Latest Processed reads like this week, not like a stalled feed.
    const staleDays = (now.getTime() - new Date(plan.latestProcessedDate).getTime()) / 86_400_000;
    expect(staleDays).toBeLessThan(4);

    // New applications land in the chart's window too.
    const chartStart = new Date(plan.latestProcessedDate);
    chartStart.setUTCDate(chartStart.getUTCDate() - 29);
    expect(
      marks.some((row) => String(row.filing_date) >= chartStart.toISOString().slice(0, 10))
    ).toBe(true);
  });

  test("covers every Source Status state an operator triages", () => {
    const artifacts = rowsFor(buildPlan(), "source_artifact");

    const downloadStates = new Set(artifacts.map((row) => row.download_state));
    expect(downloadStates).toContain("downloaded");
    expect(downloadStates).toContain("blocked");

    const applicationStates = new Set(artifacts.map((row) => row.application_state));
    expect(applicationStates).toEqual(
      new Set(["complete", "applying", "pending", "needs_attention"])
    );

    const dispositions = new Set(artifacts.map((row) => row.processing_disposition));
    expect(dispositions).toEqual(new Set(["required", "deferred", "covered"]));

    // Needs Attention and the pending queue both have something in them.
    const attention = artifacts.filter(
      (row) =>
        row.processing_disposition === "required" &&
        (row.application_state === "needs_attention" || row.download_state === "blocked")
    );
    expect(attention.length).toBeGreaterThan(1);
    expect(attention.some((row) => row.download_response_state !== null)).toBe(true);

    const pending = artifacts.filter(
      (row) =>
        row.processing_disposition === "required" &&
        row.download_state === "downloaded" &&
        (row.application_state === "pending" || row.application_state === "applying")
    );
    expect(pending.length).toBeGreaterThan(1);

    // Retained and cleaned-up storage both appear in the artifact list.
    expect(artifacts.some((row) => row.object_key !== null)).toBe(true);
    expect(
      artifacts.some((row) => row.object_key === null && row.application_state === "complete")
    ).toBe(true);

    // More than one page of artifacts, so pagination is exercised.
    expect(artifacts.length).toBeGreaterThan(25);
  });

  test("never plans an artifact the ingestion worker would act on", () => {
    // This product calls the live USPTO Open Data Portal. A seeded row that
    // matches one of the worker's reservation predicates would turn `bun run
    // db:seed:dev` into an outbound request, or into a read of artifact bytes
    // that were never downloaded. None may exist, at any seed.
    for (const seed of ["tmterminal-dev", "friday", "operator", "empty-week"]) {
      for (const row of rowsFor(buildPlan({ seed }), "source_artifact")) {
        expect(
          row.processing_disposition === "required" && row.download_state === "pending",
          `${String(row.filename)} is a download the worker would reserve`
        ).toBe(false);

        expect(
          row.download_state === "downloaded" &&
            row.object_key !== null &&
            row.sha256 !== null &&
            (row.application_state === "pending" || row.application_state === "applying"),
          `${String(row.filename)} is an application the worker would reserve`
        ).toBe(false);

        expect(
          row.download_state === "downloading",
          `${String(row.filename)} is an interrupted download the worker would recover`
        ).toBe(false);
      }
    }
  });

  test("reports a worker that has just checked in", () => {
    const plan = buildPlan();
    const [worker] = rowsFor(plan, "worker_status");
    const artifacts = rowsFor(plan, "source_artifact");

    expect(worker?.id).toBe("uspto");
    expect(worker?.current_error).toBeNull();
    expect(worker?.last_heartbeat_at).toBe(now.toISOString());
    // Discovery is due once a day, so a worker attached to a freshly seeded
    // database has nothing to discover.
    expect(
      String(worker?.last_discovery_at) > new Date(now.getTime() - 86_400_000).toISOString()
    ).toBe(true);
    expect(
      artifacts.some((row) => row.filename === worker?.current_filename),
      "the worker names a file that is not in the catalog"
    ).toBe(true);

    const [state] = rowsFor(plan, "data_state");
    expect(state?.id).toBe("uspto");
    expect(Number(state?.version)).toBeGreaterThan(0);
  });

  test("seeds an account with saved preferences", () => {
    const plan = buildPlan();
    const [account] = rowsFor(plan, "account");

    expect(account?.merchbase_user_id).toBe(defaultSeedOptions.merchbaseUserId);
    expect(account?.search_preferences).toMatchObject({ defaultStatus: "live", pageSize: 50 });
  });

  test("attributes every mark to a source file it plans", () => {
    const plan = buildPlan();
    const filenames = new Set(rowsFor(plan, "source_artifact").map((row) => String(row.filename)));

    for (const table of ["mark", "trademark_recency"]) {
      expect(
        rowsFor(plan, table).every((row) => filenames.has(String(row.source_filename))),
        `${table} cites a source file that is not in the catalog`
      ).toBe(true);
    }
  });

  test("stays a small slice rather than a data dump", () => {
    const total = Object.values(buildPlan().summary).reduce((sum, count) => sum + count, 0);

    expect(total).toBeLessThan(12_000);
  });

  test("honours a smaller catalog and a shorter window", () => {
    const plan = buildPlan({ dayCount: 14, markCount: 40 });

    expect(rowsFor(plan, "mark").length).toBe(40);
    // One artifact per day of the window, plus the annual baseline.
    expect(rowsFor(plan, "source_artifact").length).toBe(15);
  });
});
