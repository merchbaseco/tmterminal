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
const pastThirtyDaysPattern = /Past 30 days ·/;
const structuredQuotaPattern =
  /The USPTO temporarily blocked this file after 15 requests\. Try again after/;
let intersectionCallback: IntersectionObserverCallback | undefined;
const applicationActivity = Array.from({ length: 30 }, (_, index) => {
  const value = new Date(Date.UTC(2026, 5, 19 + index));
  const activityDate = value.toISOString().slice(0, 10);
  return {
    applicationUpdates: index * 1000,
    date: activityDate,
    newApplications: index * 10,
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
      counts: {
        all: 1,
        needsAttention: 0,
      },
      items: [
        {
          applicationCompletedAt: "2026-07-18T12:00:00.000Z",
          applicationState: "complete",
          appliedRecordCount: 155_000,
          artifactId: "artifact-1",
          bytes: 123,
          currentError: null,
          downloadedAt: "2026-07-18T11:30:00.000Z",
          downloadResponseState: { status: 200 },
          downloadState: "downloaded",
          filename: "apc18840407-20251231-01.zip",
          parserVersion: "uspto-projection-v2",
          physicalRecordCount: 155_000,
          processingDisposition: "required",
          product: "TRTYRAP",
          projectedMarkCount: 12_345,
          sha256: "a".repeat(64),
          sourceFromDate: "1884-04-07",
          sourceToDate: "2026-07-18",
          storageState: "cleaned-up",
          unresolvedRecordCount: 0,
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
        earliestFilingDate: "1895-04-01",
        totalMarkCount: 1_206_290,
      },
      source: {
        applicationActivity,
        currentArtifact: null,
        lastActivityAt: "2026-07-18T12:05:00.000Z",
        latestProcessedDate: "2026-07-18",
      },
    }),
  };
}

test("presents catalog coverage and cleaned-up files", async () => {
  const statusApi = api();
  render(<StatusPage api={statusApi} operatorApi={statusApi} />);
  expect(await screen.findByRole("heading", { name: "Status" })).toBeTruthy();
  expect(screen.queryByText("Status / Latest processed")).toBeNull();
  expect(screen.queryByText("Latest processed")).toBeNull();
  expect(screen.getByRole("status", { name: "Service status: Live" })).toBeTruthy();
  expect(screen.getByText("Total trademarks")).toBeTruthy();
  expect(screen.getByText("Since 1895")).toBeTruthy();
  expect(screen.getByText("New applications")).toBeTruthy();
  expect(screen.getByText("Application updates")).toBeTruthy();
  expect(screen.getAllByText("Last 30 days")).toHaveLength(2);
  expect(screen.queryByText("Coverage ·")).toBeNull();
  expect(screen.queryByText(pastThirtyDaysPattern)).toBeNull();
  expect(screen.getByRole("button", { name: "All: 1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Errors: 0" })).toBeTruthy();
  expect(screen.queryByText("Nothing needs attention.")).toBeNull();
  expect(screen.getByText("Complete · Cleaned up")).toBeTruthy();
  expect(screen.getByText("155,000 records → 12,345 marks")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Source files" })).toBeTruthy();
  expect(screen.getAllByRole("columnheader").map((heading) => heading.textContent)).toEqual([
    "File",
    "Status",
    "Processed",
    "Updated",
  ]);
  expect(screen.getByRole("region", { name: "Trademark catalog" })).toBeTruthy();
  expect(screen.getByText("1,206,290")).toBeTruthy();
  expect(screen.getByText("4,350")).toBeTruthy();
  expect(screen.getByText("435,000")).toBeTruthy();
  expect(screen.queryByText("System details")).toBeNull();
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.queryByText("Corpus")).toBeNull();
  expect(screen.queryByText("Complete through")).toBeNull();
  expect(screen.queryByText("a".repeat(12))).toBeNull();
  expect(screen.queryByText("Retained ZIP unavailable from pre-retention ingestion")).toBeNull();
});

test("filters the source-file ledger with server-backed counts", async () => {
  const filteredApi = api();
  const filters: string[] = [];
  filteredApi.artifacts = async (input) => {
    filters.push(input.filter ?? "all");
    const page = await api().artifacts(input);
    if (input.filter !== "needs-attention") {
      return page;
    }
    return {
      ...page,
      counts: {
        all: 1,
        needsAttention: 1,
      },
      items: page.items.map((artifact) => ({
        ...artifact,
        applicationState: "pending" as const,
        downloadState: "blocked" as const,
      })),
    };
  };

  render(<StatusPage api={filteredApi} operatorApi={filteredApi} />);
  expect(await screen.findByText("Complete · Cleaned up")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Errors: 0" }));

  expect(await screen.findByText("Needs attention", { selector: "td" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Errors: 1" }).getAttribute("aria-pressed")).toBe(
    "true"
  );
  expect(filters).toEqual(["all", "needs-attention"]);
});

test("mirrors the status layout while aggregate data loads", () => {
  const pendingApi = api();
  pendingApi.status = () => new Promise(() => undefined);

  render(<StatusPage api={pendingApi} />);

  expect(screen.getByRole("status", { name: "Loading status" })).toBeTruthy();
  expect(screen.getByTestId("status-page-skeleton")).toBeTruthy();
  expect(screen.queryByText("Loading status…")).toBeNull();
});

test("explains source files displaced by broad coverage", async () => {
  const sourceApi = api();
  sourceApi.artifacts = async ({ filter, limit, offset }) => {
    const page = await api().artifacts({ filter, limit, offset });
    const [source] = page.items;
    if (!source) {
      throw new Error("Source fixture is unavailable");
    }
    return {
      ...page,
      items: [
        { ...source, artifactId: "deferred", processingDisposition: "deferred" as const },
        { ...source, artifactId: "covered", processingDisposition: "covered" as const },
      ],
      total: 2,
    };
  };

  render(<StatusPage api={sourceApi} operatorApi={sourceApi} />);
  expect(await screen.findByText("Not required · Selected broad source pending")).toBeTruthy();
  expect(screen.getByText("Not downloaded · Covered by newer source data")).toBeTruthy();
});

test("charts thirty days of trademark applications and updates", async () => {
  const chartApi = api();

  render(<StatusPage api={chartApi} />);
  expect(
    await screen.findByRole("heading", { name: "Trademark applications and updates" })
  ).toBeTruthy();
  expect(screen.getByText("435,000")).toBeTruthy();
  expect(
    screen.getByRole("listitem", {
      name: "Jun 19, 2026 · 0 new applications · 0 application updates",
    })
  ).toBeTruthy();
  expect(
    screen.getByRole("listitem", {
      name: "Jul 5, 2026 · 160 new applications · 16,000 application updates",
    })
  ).toBeTruthy();
  expect(
    screen.getByRole("listitem", {
      name: "Jul 18, 2026 · 290 new applications · 29,000 application updates",
    })
  ).toBeTruthy();
});

test("appends source files on scroll and retries a failed page", async () => {
  const scrollingApi = api();
  const offsets: number[] = [];
  let failNextPage = true;
  scrollingApi.artifacts = async ({ filter, limit: pageLimit, offset }) => {
    offsets.push(offset);
    if (offset === 1 && failNextPage) {
      throw new Error("page failed");
    }
    const page = await api().artifacts({ filter, limit: pageLimit, offset });
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
      counts: { ...page.counts, needsAttention: 1 },
      items: page.items.map((artifact) => ({
        ...artifact,
        applicationState: "pending" as const,
        currentError: "429 from a provider endpoint",
        downloadState: "blocked" as const,
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
            message: null,
            providerRequestCount: 15,
            retryNotBefore: "2026-07-25T12:00:00.000Z",
            stage: "download" as const,
            updatedAt: "2026-07-18T12:00:00.000Z",
          },
        ],
        total: 1,
      },
    };
  };
  render(<StatusPage api={failedApi} operatorApi={failedApi} />);
  expect(await screen.findByText(structuredQuotaPattern)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Errors: 1" })).toBeTruthy();
  expect(screen.queryByText(searchablePattern)).toBeNull();
  expect(screen.getByText("Needs attention", { selector: "td" })).toBeTruthy();
  expect(screen.queryByText("429 from a provider endpoint")).toBeNull();
  expect(screen.queryByText("Corpus sync")).toBeNull();
});

test("falls back to generic rate-limit copy without structured provider facts", async () => {
  const failedApi = api();
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
            message: null,
            providerRequestCount: null,
            retryNotBefore: null,
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
});

test("shows an ingestion worker failure to operators", async () => {
  const failedApi = api();
  failedApi.status = async () => {
    const status = await api().status();
    return {
      ...status,
      attention: {
        items: [
          {
            artifactId: "worker",
            filename: "Ingestion worker",
            httpStatus: null,
            message: "Artifact storage is unavailable.",
            providerRequestCount: null,
            retryNotBefore: null,
            stage: "worker" as const,
            updatedAt: "2026-07-18T12:00:00.000Z",
          },
        ],
        total: 1,
      },
    };
  };

  render(<StatusPage api={failedApi} operatorApi={failedApi} />);
  expect(await screen.findByText("Artifact storage is unavailable.")).toBeTruthy();
});

test("shows the current file as quiet background work", async () => {
  const processingApi = api();
  processingApi.status = async () => {
    const status = await api().status();
    return {
      ...status,
      source: {
        ...status.source,
        currentArtifact: { filename: "apc-20260719.zip", state: "applying" as const },
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
  expect(await screen.findByRole("heading", { name: "Status" })).toBeTruthy();
  expect(screen.queryByText("Needs attention")).toBeNull();
  expect(screen.queryByText("Source files")).toBeNull();
});
