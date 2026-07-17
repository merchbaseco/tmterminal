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
      generation: {
        activeGenerationId: null,
        completeArtifactCount: 1,
        expectedArtifactCount: 91,
        failedArtifactCount: 0,
        projectedMarkCount: 12_345,
      },
      provider: { currentError: null, failureCount: 0, nextEligibleAt: null, status: "ready" },
      summary: {
        activeState: "idle",
        completeThroughDate: null,
        corpusVersion: 0,
        degraded: true,
        degradedSince: null,
        failedCount: 0,
        lastSuccessfulMergeAt: null,
        pendingCount: 90,
        publishedThroughDate: null,
        quarantineCount: 0,
        reissueSelectionRequiredCount: 0,
        rejectCount: 0,
        stale: true,
        staleSince: null,
      },
    }),
  };
}

test("shows the compact annual generation and artifact state", async () => {
  render(<OperatorSyncPage api={api()} />);
  expect(await screen.findByText("1 of 91 complete")).toBeTruthy();
  expect(screen.getAllByText("12,345")).toHaveLength(2);
  expect(screen.getByText("apc18840407-20251231-01.zip")).toBeTruthy();
  expect(screen.queryByText("Artifact versions")).toBeNull();
  expect(screen.queryByText("Recent publications")).toBeNull();
});

test("keeps the operator surface closed to a forbidden Clerk viewer", async () => {
  const forbidden = { data: { code: "FORBIDDEN" } };
  const forbiddenApi: OperatorSyncApi = {
    artifacts: () => Promise.reject(forbidden),
    status: () => Promise.reject(forbidden),
  };
  render(<OperatorSyncPage api={forbiddenApi} />);
  expect((await screen.findByRole("alert")).textContent).toContain("server-side operator role");
  expect(screen.queryByText("Annual artifacts")).toBeNull();
});
