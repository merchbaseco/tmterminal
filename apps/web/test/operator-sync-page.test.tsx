import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { StatusPage } = await import("../src/operator-sync-page.tsx");
type OperatorSyncApi = import("../src/operator-sync-page.tsx").OperatorSyncApi;

afterEach(cleanup);

const searchablePattern = /searchable/i;
let intersectionCallback: IntersectionObserverCallback | undefined;
const processingActivity = Array.from({ length: 30 }, (_, index) => {
  const value = new Date(Date.UTC(2026, 5, 19 + index));
  const activityDate = value.toISOString().slice(0, 10);
  return {
    count: index * 1000,
    date: activityDate,
  };
});

class TestIntersectionObserver implements IntersectionObserver {
  private readonly callback: IntersectionObserverCallback;
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    intersectionCallback = callback;
  }
  disconnect() {
    if (intersectionCallback === this.callback) {
      intersectionCallback = undefined;
    }
  }
  observe() {
    // Intersection delivery is driven explicitly by each test.
  }
  takeRecords() {
    return [];
  }
  unobserve() {
    // Intersection delivery is driven explicitly by each test.
  }
}

globalThis.IntersectionObserver = TestIntersectionObserver;

function api(): OperatorSyncApi {
  return {
    artifacts: async ({ limit, offset }) => ({
      items: [
        {
          artifactId: "artifact-1",
          bytes: 123,
          downloadError: "Retained ZIP unavailable from pre-retention ingestion",
          downloadedAt: "2026-07-18T11:30:00.000Z",
          downloadResponseState: { status: 200 },
          downloadState: "unavailable",
          filename: "apc18840407-20251231-01.zip",
          physicalRecordCount: 155_000,
          product: "TRTYRAP",
          projectedMarkCount: 12_345,
          projectionCompletedAt: "2026-07-18T12:00:00.000Z",
          projectionError: null,
          projectionState: "complete",
          projectionVersion: "uspto-projection-v1",
          sha256: "a".repeat(64),
          sourceFromDate: "1884-04-07",
          sourceToDate: "2026-07-18",
          storageState: "cleaned-up",
          updatedAt: "2026-07-18T12:00:00.000Z",
        },
      ],
      limit,
      offset,
      total: 1,
    }),
    status: async () => ({
      attention: { items: [], total: 0 },
      catalog: {
        liveMarkCount: 396_199,
        registeredMarkCount: 585_549,
        totalMarkCount: 1_206_290,
      },
      provider: { status: "ready" },
      source: {
        currentArtifact: null,
        lastActivityAt: "2026-07-18T12:05:00.000Z",
        latestProcessedDate: "2026-07-18",
        processingActivity,
      },
    }),
  };
}

test("presents the latest processed source and cleaned-up files", async () => {
  const statusApi = api();
  render(<StatusPage api={statusApi} operatorApi={statusApi} />);
  expect(await screen.findByText("Status / Latest processed")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Jul 18, 2026" })).toBeTruthy();
  expect(screen.getByText("Nothing needs attention.")).toBeTruthy();
  expect(screen.getByText("Complete · Cleaned up")).toBeTruthy();
  expect(screen.getByText("155,000 records → 12,345 marks")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Source files" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Trademark catalog" })).toBeTruthy();
  expect(screen.getByText("1,206,290")).toBeTruthy();
  expect(screen.getByText("396,199")).toBeTruthy();
  expect(screen.getByText("585,549")).toBeTruthy();
  expect(screen.queryByText("System details")).toBeNull();
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.queryByText("Corpus")).toBeNull();
  expect(screen.queryByText("Complete through")).toBeNull();
  expect(screen.queryByText("a".repeat(12))).toBeNull();
  expect(screen.queryByText("Retained ZIP unavailable from pre-retention ingestion")).toBeNull();
});

test("charts thirty days of processed source records", async () => {
  const chartApi = api();

  render(<StatusPage api={chartApi} />);
  expect(await screen.findByRole("heading", { name: "Records processed" })).toBeTruthy();
  expect(screen.getByText("Past 30 days · Jun 19 – Jul 18, 2026")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Jun 19, 2026 · 0 records" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Jul 5, 2026 · 16,000 records" })).toBeTruthy();
  const latestBar = screen.getByRole("button", { name: "Jul 18, 2026 · 29,000 records" });
  expect(latestBar).toBeTruthy();
  expect(screen.queryByTitle("Jul 18, 2026 · 29,000 records")).toBeNull();
});

test("appends source files on scroll and retries a failed page", async () => {
  const scrollingApi = api();
  const offsets: number[] = [];
  let failNextPage = true;
  scrollingApi.artifacts = async ({ limit: pageLimit, offset }) => {
    offsets.push(offset);
    if (offset === 1 && failNextPage) {
      throw new Error("page failed");
    }
    const page = await api().artifacts({ limit: pageLimit, offset });
    return {
      ...page,
      items: page.items.map((artifact) => ({
        ...artifact,
        artifactId: `artifact-${offset + 1}`,
        filename: `apc-202607${18 - offset}.zip`,
      })),
      total: 2,
    };
  };

  render(<StatusPage api={scrollingApi} operatorApi={scrollingApi} />);
  expect(await screen.findByText("apc-20260718.zip")).toBeTruthy();
  act(() => {
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "More source files could not be loaded."
  );
  failNextPage = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("apc-20260717.zip")).toBeTruthy();
  expect(screen.getByText("apc-20260718.zip")).toBeTruthy();
  expect(offsets).toEqual([0, 1, 1]);
  expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
});

test("explains a rate-limited source file without implying existing data is unavailable", async () => {
  const failedApi = api();
  failedApi.artifacts = async (input) => {
    const page = await api().artifacts(input);
    return {
      ...page,
      items: page.items.map((artifact) => ({
        ...artifact,
        downloadError: "429 from a provider endpoint",
        downloadState: "failed" as const,
        projectionState: "pending" as const,
        storageState: "not-downloaded" as const,
      })),
    };
  };
  failedApi.status = async () => {
    const status = await api().status();
    return {
      ...status,
      attention: {
        items: [
          {
            artifactId: "artifact-1",
            filename: "apc18840407-20251231-01.zip",
            httpStatus: 429,
            stage: "download" as const,
            updatedAt: "2026-07-18T12:00:00.000Z",
          },
        ],
        total: 1,
      },
    };
  };
  render(<StatusPage api={failedApi} operatorApi={failedApi} />);
  expect(
    await screen.findByText(
      "The USPTO rate-limited this download. It needs a new download attempt."
    )
  ).toBeTruthy();
  expect(screen.queryByText(searchablePattern)).toBeNull();
  expect(screen.getByText("Needs attention", { selector: "span" })).toBeTruthy();
  expect(screen.queryByText("429 from a provider endpoint")).toBeNull();
  expect(screen.queryByText("Corpus sync")).toBeNull();
});

test("shows the current file as quiet background work", async () => {
  const processingApi = api();
  processingApi.status = async () => {
    const status = await api().status();
    return {
      ...status,
      source: {
        ...status.source,
        currentArtifact: { filename: "apc-20260719.zip", state: "processing" as const },
      },
    };
  };
  render(<StatusPage api={processingApi} />);
  const filename = await screen.findByText("apc-20260719.zip");
  expect(filename.closest("p")?.textContent).toContain("Processing");
  expect(filename.closest("p")?.textContent).toContain("Processed data remains searchable");
});

test("hides operator sections from the public status surface", async () => {
  render(<StatusPage api={api()} />);
  expect(await screen.findByRole("heading", { name: "Jul 18, 2026" })).toBeTruthy();
  expect(screen.queryByText("Needs attention")).toBeNull();
  expect(screen.queryByText("Source files")).toBeNull();
});
