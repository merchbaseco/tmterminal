import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];

const { cleanup, render, screen } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { OperatorSyncPage } = await import("../src/operator-sync-page.tsx");
type OperatorSyncApi = import("../src/operator-sync-page.tsx").OperatorSyncApi;

afterEach(cleanup);

const baselinePattern = /baseline/i;

function api(): OperatorSyncApi {
  return {
    artifacts: async ({ limit, offset }) => ({
      items: [
        {
          artifactId: "artifact-1",
          bytes: 123,
          completedAt: null,
          currentError: null,
          filename: "apc18840407-20251231-01.zip",
          physicalRecordCount: 155_000,
          product: "TRTYRAP",
          projectedMarkCount: 12_345,
          sha256: "a".repeat(64),
          sourceFromDate: "1884-04-07",
          sourceToDate: "2025-12-31",
          state: "complete",
          updatedAt: "2026-07-17T12:00:00.000Z",
        },
      ],
      limit,
      offset,
      total: 91,
    }),
    status: async () => ({
      annualBaseline: {
        completeArtifactCount: 1,
        expectedArtifactCount: 91,
        failedArtifactCount: 0,
        projectedMarkCount: 12_345,
      },
      provider: { currentError: null, failureCount: 0, nextEligibleAt: null, status: "ready" },
      source: {
        lastActivityAt: "2026-07-17T12:05:00.000Z",
        physicalRecordCount: 155_000,
        projectedMarkCount: 23_456,
      },
      summary: {
        activeState: "parsing",
        completeThroughDate: "2025-12-31",
        dataVersion: 1,
        degraded: false,
        degradedSince: null,
        failedCount: 0,
        lastSuccessfulUpdateAt: "2026-07-17T11:00:00.000Z",
        pendingCount: 90,
        stale: false,
        staleSince: null,
      },
    }),
  };
}

test("presents corpus synchronization as ongoing work", async () => {
  render(<OperatorSyncPage api={api()} />);
  expect(await screen.findByText("Corpus sync active.")).toBeTruthy();
  expect(
    screen.getByText("Trademark Turtle continuously processes USPTO trademark data.")
  ).toBeTruthy();
  expect(screen.getByText("Marks processed")).toBeTruthy();
  expect(screen.getByText("23,456")).toBeTruthy();
  expect(screen.getByText("Source records processed")).toBeTruthy();
  expect(screen.getAllByText("Complete through")).toHaveLength(2);
  expect(screen.getByText("Last activity")).toBeTruthy();
  expect(screen.getByText("Sync issues")).toBeTruthy();
  expect(screen.queryByText(baselinePattern)).toBeNull();
  expect(screen.queryByText("Now")).toBeNull();
  expect(screen.queryByText("Next", { selector: "p" })).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Recent activity" })).toBeNull();
  expect(screen.getByRole("table", { name: "Source files" })).toBeTruthy();
  expect(screen.getByRole("table", { name: "System details" })).toBeTruthy();
  expect(screen.queryByText("Technical details")).toBeNull();
  expect(screen.queryByText("Source file ledger")).toBeNull();
  expect(screen.getByText("USPTO trademark XML")).toBeTruthy();
  expect(screen.getByText("apc18840407-20251231-01.zip")).toBeTruthy();
  expect(screen.getByText("Complete", { selector: ".artifact-state" })).toBeTruthy();
});

test("surfaces a synchronization issue without exposing queue position", async () => {
  const failedApi = api();
  failedApi.artifacts = async (input) => {
    const page = await api().artifacts(input);
    return {
      ...page,
      items: page.items.map((artifact) => ({
        ...artifact,
        currentError: "Archive checksum did not match",
        state: "failed" as const,
      })),
    };
  };
  failedApi.status = async () => {
    const status = await api().status();
    return {
      ...status,
      annualBaseline: { ...status.annualBaseline, failedArtifactCount: 1 },
      summary: { ...status.summary, activeState: "failed" as const },
    };
  };
  render(<OperatorSyncPage api={failedApi} />);
  expect(await screen.findByText("Corpus sync needs attention.")).toBeTruthy();
  expect(screen.getByText("A source file failed to process.")).toBeTruthy();
  expect(screen.getByText("Failed", { selector: ".artifact-state" })).toBeTruthy();
  expect(screen.getByText("Archive checksum did not match")).toBeTruthy();
});

test("does not present stale corpus data as healthy", async () => {
  const staleApi = api();
  staleApi.status = async () => {
    const status = await api().status();
    return { ...status, summary: { ...status.summary, stale: true } };
  };
  render(<OperatorSyncPage api={staleApi} />);
  expect(await screen.findByText("Corpus sync is delayed.")).toBeTruthy();
  expect(
    screen.getByText("Complete trademark data currently runs through Dec 31, 2025.")
  ).toBeTruthy();
});

test("keeps the operator surface closed to a forbidden Clerk viewer", async () => {
  const forbidden = { data: { code: "FORBIDDEN" } };
  const forbiddenApi: OperatorSyncApi = {
    artifacts: () => Promise.reject(forbidden),
    status: () => Promise.reject(forbidden),
  };
  render(<OperatorSyncPage api={forbiddenApi} />);
  expect((await screen.findByRole("alert")).textContent).toContain("server-side operator role");
  expect(screen.queryByText("Source files")).toBeNull();
});
