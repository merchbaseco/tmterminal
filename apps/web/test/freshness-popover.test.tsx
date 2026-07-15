import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
Element.prototype.getAnimations ??= () => [];

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { FreshnessPopover } = await import("../src/freshness-popover.tsx");

afterEach(cleanup);

test("refreshes truthful corpus status each time the stock popover opens", async () => {
  let reads = 0;
  const status = {
    activeState: "idle" as const,
    completeThroughDate: "2026-01-01",
    corpusVersion: 9,
    degraded: false,
    degradedSince: null,
    failedCount: 0,
    lastSuccessfulMergeAt: "2026-07-15T11:00:00.000Z",
    pendingCount: 0,
    publishedThroughDate: "2026-01-01",
    quarantineCount: 0,
    rejectCount: 0,
    reissueSelectionRequiredCount: 0,
    stale: false,
    staleSince: null,
  };
  render(<FreshnessPopover api={{ status: async () => { reads += 1; return status; } }} />);

  fireEvent.click(screen.getByRole("button", { name: "Corpus freshness" }));
  expect(await screen.findByText("Complete through")).toBeTruthy();
  expect(screen.getAllByText("Jan 1, 2026")).toHaveLength(2);
  expect(screen.getByText("Current")).toBeTruthy();
  expect(reads).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: /Corpus through/ }));
  fireEvent.click(screen.getByRole("button", { name: /Corpus through/ }));
  await waitFor(() => expect(reads).toBe(2));
});

test("an older open request cannot overwrite the newest freshness snapshot", async () => {
  const status = (completeThroughDate: string) => ({
    activeState: "idle" as const,
    completeThroughDate,
    corpusVersion: 9,
    degraded: false,
    degradedSince: null,
    failedCount: 0,
    lastSuccessfulMergeAt: "2026-07-15T11:00:00.000Z",
    pendingCount: 0,
    publishedThroughDate: completeThroughDate,
    quarantineCount: 0,
    rejectCount: 0,
    reissueSelectionRequiredCount: 0,
    stale: false,
    staleSince: null,
  });
  const resolutions: Array<(value: ReturnType<typeof status>) => void> = [];
  render(<FreshnessPopover api={{ status: () => new Promise((resolve) => resolutions.push(resolve)) }} />);

  fireEvent.click(screen.getByRole("button", { name: "Corpus freshness" }));
  fireEvent.click(screen.getByRole("button", { name: "Corpus freshness" }));
  fireEvent.click(screen.getByRole("button", { name: "Corpus freshness" }));
  await waitFor(() => expect(resolutions).toHaveLength(2));
  await act(async () => resolutions[1]!(status("2026-01-02")));
  expect(screen.getByRole("button", { name: /Jan 2, 2026/ })).toBeTruthy();
  await act(async () => resolutions[0]!(status("2026-01-01")));
  expect(screen.getByRole("button", { name: /Jan 2, 2026/ })).toBeTruthy();
});

test("shows the stale boundary from the typed freshness contract", async () => {
  render(<FreshnessPopover api={{ status: async () => ({
    activeState: "idle",
    completeThroughDate: "2025-12-28",
    corpusVersion: 8,
    degraded: true,
    degradedSince: "2026-01-01T00:00:00.000Z",
    failedCount: 0,
    lastSuccessfulMergeAt: "2025-12-28T12:00:00.000Z",
    pendingCount: 0,
    publishedThroughDate: "2025-12-28",
    quarantineCount: 0,
    rejectCount: 0,
    reissueSelectionRequiredCount: 0,
    stale: true,
    staleSince: "2026-01-01T00:00:00.000Z",
  }) }} />);

  fireEvent.click(screen.getByRole("button", { name: "Corpus freshness" }));
  expect(await screen.findByText("Stale since Jan 1, 2026")).toBeTruthy();
});
