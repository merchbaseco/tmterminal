import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { FreshnessPopover } = await import("../src/freshness-popover.tsx");
type FreshnessApi = import("../src/freshness-popover.tsx").FreshnessApi;

afterEach(cleanup);

function renderFreshness(api: FreshnessApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FreshnessPopover api={api} />
    </QueryClientProvider>
  );
}

const currentStatus = {
  activeState: "idle" as const,
  completeThroughDate: "2026-01-01",
  dataVersion: 9,
  degraded: false,
  degradedSince: null,
  failedCount: 0,
  lastSuccessfulUpdateAt: "2026-07-15T11:00:00.000Z",
  pendingCount: 0,
  stale: false,
  staleSince: null,
};
const operatorDiagnosticsPattern = /quarantined|rejected|failed/i;

test("shows ambient corpus coverage and refreshes when the popover opens", async () => {
  let reads = 0;
  renderFreshness({
    status: () => {
      reads += 1;
      return Promise.resolve(currentStatus);
    },
  });

  const trigger = await screen.findByRole("button", { name: "Corpus through Jan 1, 2026" });
  expect(reads).toBe(1);
  fireEvent.click(trigger);

  expect(await screen.findByText("Complete through")).toBeTruthy();
  expect(screen.getByText("Jan 1, 2026")).toBeTruthy();
  expect(screen.getByText("Up to date")).toBeTruthy();
  await waitFor(() => expect(reads).toBe(2));
});

test("describes ongoing corpus synchronization without queue progress", async () => {
  renderFreshness({
    status: () =>
      Promise.resolve({
        ...currentStatus,
        activeState: "parsing",
        completeThroughDate: null,
        dataVersion: 0,
        degraded: true,
        lastSuccessfulUpdateAt: null,
        pendingCount: 75,
        stale: true,
      }),
  });

  const trigger = await screen.findByRole("button", { name: "Corpus syncing" });
  fireEvent.click(trigger);

  expect(await screen.findByText("Syncing — processing source data")).toBeTruthy();
  expect(screen.queryByText("16 of 91 source files complete")).toBeNull();
  expect(screen.getByText("Last update")).toBeTruthy();
  expect(screen.queryByText("Diagnostics")).toBeNull();
  expect(screen.queryByText(operatorDiagnosticsPattern)).toBeNull();
});

test("shows the stale boundary from the typed freshness contract", async () => {
  renderFreshness({
    status: () =>
      Promise.resolve({
        ...currentStatus,
        completeThroughDate: "2025-12-28",
        dataVersion: 8,
        degraded: true,
        degradedSince: "2026-01-01T00:00:00.000Z",
        stale: true,
        staleSince: "2026-01-01T00:00:00.000Z",
      }),
  });

  const trigger = await screen.findByRole("button", { name: "Corpus through Dec 28, 2025" });
  fireEvent.click(trigger);
  expect(await screen.findByText("Stale since Jan 1, 2026")).toBeTruthy();
});
