import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];
const { getBoundingClientRect } = HTMLElement.prototype;
HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.dataset.testid === "search-results-viewport") {
    return new DOMRect(0, 0, 1200, 640);
  }
  if (this.dataset.testid === "search-result-row") {
    return new DOMRect(0, 0, 1200, 188);
  }
  return getBoundingClientRect.call(this);
};

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { afterEach, beforeEach, expect, test, vi } = await import("bun:test");
const { useState } = await import("react");
const { SearchPage } = await import("../src/search-page.tsx");
type SearchApi = import("../src/search-page.tsx").SearchApi;
type SearchPageResult = Awaited<ReturnType<SearchApi["search"]>>;

const markLinkPattern = /TURTLE MARK/;
const noop = () => undefined;

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

let intersectionCallback: IntersectionObserverCallback | undefined;

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

class TestResizeObserver implements ResizeObserver {
  private active = true;
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  disconnect() {
    this.active = false;
  }
  observe(target: Element) {
    const blockSize = (target as HTMLElement).dataset.testid === "search-result-row" ? 188 : 640;
    queueMicrotask(() => {
      // biome-ignore lint/suspicious/noUnnecessaryConditions: disconnect can run before this queued callback.
      if (!this.active) {
        return;
      }
      this.callback(
        [
          {
            borderBoxSize: [{ blockSize, inlineSize: 1200 }],
            contentBoxSize: [{ blockSize, inlineSize: 1200 }],
            contentRect: new DOMRectReadOnly(0, 0, 1200, blockSize),
            devicePixelContentBoxSize: [],
            target,
          },
        ],
        this
      );
    });
  }
  unobserve() {
    // Resize delivery is driven by observe.
  }
}

function resultPage(offset: number, count: number, total: number): SearchPageResult {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      goodsServicesExcerpt: "shirts and sweatshirts",
      internationalClasses: ["025"],
      match: index === 0 && offset === 0 ? "exact" : "partial",
      owner: "TURTLE GOODS LLC",
      registrationNumber: String(7_000_001 + offset + index),
      serialNumber: String(70_000_001 + offset + index),
      sourceTransactionDate: "2026-07-10",
      status: "live",
      statusDate: "2026-07-09",
      type: "text",
      wordMark: `TURTLE MARK ${offset + index + 1}`,
    })),
    limit: 25,
    meta: { dataThroughDate: "2026-07-10", dataVersion: "7" },
    offset,
    total,
  };
}

function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSearch(
  api: SearchApi,
  initialSearch = "?q=turtle&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance",
  options: {
    onOpenMark?: (serialNumber: string, scrollOffset: number) => void;
    restoreScrollOffset?: number;
  } = {}
) {
  const queryClient = testQueryClient();
  function Harness() {
    const [entry, setEntry] = useState({
      search: initialSearch,
      sourceSearch: undefined as string | undefined,
    });
    return (
      <QueryClientProvider client={queryClient}>
        <SearchPage
          api={api}
          // biome-ignore lint/performance/noJsxPropsBind: The test harness owns URL navigation state locally.
          onNavigate={(href, sourceSearch) =>
            setEntry({
              search: new URL(href, "https://example.test").search,
              sourceSearch,
            })
          }
          onOpenMark={options.onOpenMark ?? noop}
          onReplacementLoaded={noop}
          replacementSourceSearch={entry.sourceSearch}
          restoreScrollOffset={options.restoreScrollOffset ?? 0}
          search={entry.search}
        />
      </QueryClientProvider>
    );
  }
  return { queryClient, view: render(<Harness />) };
}

beforeEach(() => {
  intersectionCallback = undefined;
  globalThis.IntersectionObserver = TestIntersectionObserver;
  globalThis.ResizeObserver = TestResizeObserver;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

test("URL state drives exact-only, partial-only, both, and server filters", async () => {
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      return Promise.resolve(resultPage(0, 0, 0));
    },
  };
  renderSearch(
    api,
    "?q=turtle&mode=multi&exact=true&partial=false&status=dead&type=design&registered=yes&sort=oldest-activity"
  );

  await screen.findByText("No Class 025 marks match this search.");
  expect(inputs[0]).toEqual({
    limit: 25,
    match: "exact",
    mode: "multi",
    offset: 0,
    query: "turtle",
    registered: "yes",
    sort: "oldest-activity",
    status: "dead",
    type: "design",
  });

  fireEvent.click(screen.getByRole("checkbox", { name: "Partial" }));
  await waitFor(() => expect(inputs.at(-1)?.match).toBe("both"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Exact" }));
  await waitFor(() => expect(inputs.at(-1)?.match).toBe("partial"));
  expect((screen.getByRole("checkbox", { name: "Partial" }) as HTMLInputElement).disabled).toBe(
    true
  );
});

test("submitting a draft query updates the URL-owned request", async () => {
  const queries: string[] = [];
  const api: SearchApi = {
    search: (input) => {
      queries.push(input.query);
      return Promise.resolve(resultPage(0, 0, 0));
    },
  };
  renderSearch(api);
  await screen.findByText("No Class 025 marks match this search.");

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "new literal % query" },
  });
  expect(queries).toEqual(["turtle"]);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => expect(queries).toEqual(["turtle", "new literal % query"]));
});

test("a failed replacement search keeps the previous successful results", async () => {
  let rejectReplacement: ((error: Error) => void) | undefined;
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      if (input.query === "turtle") {
        return Promise.resolve(resultPage(0, 25, 26));
      }
      return new Promise((_, reject) => {
        rejectReplacement = reject;
      });
    },
  };
  renderSearch(api);
  expect(await screen.findByRole("link", { name: "TURTLE MARK 1" })).toBeTruthy();

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => expect(rejectReplacement).toBeDefined());
  expect(screen.getByRole("link", { name: "TURTLE MARK 1" })).toBeTruthy();
  await act(() =>
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
  expect(inputs).toHaveLength(2);
  await act(async () =>
    rejectReplacement?.(
      Object.assign(new Error("unavailable"), {
        data: { code: "SERVICE_UNAVAILABLE" },
      })
    )
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "New search could not be loaded. Previous results are still shown."
  );
  expect(screen.getByRole("link", { name: "TURTLE MARK 1" })).toBeTruthy();
  expect(screen.getByText("26 results")).toBeTruthy();
});

test("normalizes whitespace-only and double-disabled direct URL state", async () => {
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      return Promise.resolve(resultPage(0, 0, 0));
    },
  };
  const whitespace = renderSearch(api, "?q=+++&mode=multi&exact=false&partial=false");
  expect(screen.getByText("Enter one mark query to search Class 025 records.")).toBeTruthy();
  expect(inputs).toHaveLength(0);
  whitespace.view.unmount();

  renderSearch(api, "?q=turtle&mode=multi&exact=false&partial=false");
  await screen.findByText("No Class 025 marks match this search.");
  expect(inputs[0]?.match).toBe("partial");
  expect((screen.getByRole("checkbox", { name: "Partial" }) as HTMLInputElement).checked).toBe(
    true
  );
});

test("infinite pagination pins data version and keeps the list virtualized", async () => {
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      return Promise.resolve(input.offset === 0 ? resultPage(0, 25, 26) : resultPage(25, 1, 26));
    },
  };
  renderSearch(api);

  await screen.findByText("26 results");
  expect(screen.getAllByTestId("search-result-row").length).toBeLessThan(25);
  await act(() =>
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );

  await waitFor(() => expect(inputs).toHaveLength(2));
  expect(inputs[1]).toMatchObject({ expectedDataVersion: "7", limit: 25, offset: 25 });
});

test("renders loading, empty, server error, and typed continuation conflict without fallback", async () => {
  let resolveFirst: ((page: SearchPageResult) => void) | undefined;
  const loadingApi: SearchApi = {
    search: () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
  };
  const loading = renderSearch(loadingApi);
  expect(screen.getByText("Searching Class 025…")).toBeTruthy();
  resolveFirst?.(resultPage(0, 0, 0));
  expect(await screen.findByText("No Class 025 marks match this search.")).toBeTruthy();
  loading.view.unmount();

  const serverError = Object.assign(new Error("database unavailable"), {
    data: { code: "INTERNAL_SERVER_ERROR" },
  });
  renderSearch({
    search: () => Promise.reject(serverError),
  });
  expect((await screen.findByRole("alert")).textContent).toBe("Search could not be loaded.");
  cleanup();

  renderSearch({
    search: (input) =>
      input.offset === 0 ? Promise.resolve(resultPage(0, 25, 26)) : Promise.reject(serverError),
  });
  await screen.findByText("26 results");
  await act(() =>
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
  expect((await screen.findByRole("alert")).textContent).toBe("Search could not be loaded.");
  expect(screen.queryByText("26 results")).toBeNull();
  expect(screen.queryAllByTestId("search-result-row")).toHaveLength(0);
  expect(intersectionCallback).toBeUndefined();
  cleanup();

  const conflict = Object.assign(new Error("Trademark data changed during pagination"), {
    data: { code: "CONFLICT" },
  });
  const conflictInputs: Parameters<SearchApi["search"]>[0][] = [];
  renderSearch({
    search: (input) => {
      conflictInputs.push(input);
      return input.offset === 0 ? Promise.resolve(resultPage(0, 25, 26)) : Promise.reject(conflict);
    },
  });
  await screen.findByText("26 results");
  await act(() =>
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Trademark data changed. Run the search again before continuing."
  );
  expect(screen.getAllByTestId("search-result-row").length).toBeGreaterThan(0);
  expect(intersectionCallback).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Run search again" }));
  await waitFor(() => expect(conflictInputs.filter((input) => input.offset === 0)).toHaveLength(2));
});

test("a stale replacement transition cannot expose results after a continuation error", async () => {
  const serverError = Object.assign(new Error("database unavailable"), {
    data: { code: "INTERNAL_SERVER_ERROR" },
  });
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  renderSearch({
    search: (input) => {
      inputs.push(input);
      if (input.query === "turtle") {
        return Promise.resolve(resultPage(0, 1, 1));
      }
      return input.offset === 0
        ? Promise.resolve(resultPage(0, 25, 26))
        : Promise.reject(serverError);
    },
  });
  await screen.findByText("1 result");

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("26 results");
  await act(() =>
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );

  expect((await screen.findByRole("alert")).textContent).toBe("Search could not be loaded.");
  expect(screen.queryByText("26 results")).toBeNull();
  expect(screen.queryAllByTestId("search-result-row")).toHaveLength(0);
  expect(inputs.at(-1)).toMatchObject({ offset: 25, query: "replacement" });
});

test("the query cache and browser-entry offset restore two loaded pages and scroll after detail", async () => {
  let calls = 0;
  const opened: [string, number][] = [];
  const api: SearchApi = {
    search: (input) => {
      calls += 1;
      return Promise.resolve(input.offset === 0 ? resultPage(0, 25, 26) : resultPage(25, 1, 26));
    },
  };
  const queryClient = testQueryClient();
  const props = {
    api,
    onNavigate: noop,
    onOpenMark: (serialNumber: string, scrollOffset: number) =>
      opened.push([serialNumber, scrollOffset]),
    onReplacementLoaded: noop,
    search:
      "?q=turtle&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance",
  };
  const first = render(
    <QueryClientProvider client={queryClient}>
      <SearchPage {...props} restoreScrollOffset={0} />
    </QueryClientProvider>
  );
  await screen.findByText("26 results");
  await act(() =>
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
  await waitFor(() => expect(calls).toBe(2));
  const viewport = screen.getByTestId("search-results-viewport");
  viewport.scrollTop = 420;
  const link = required(
    screen.getAllByRole("link", { name: markLinkPattern })[0],
    "expected first mark link"
  );
  fireEvent.click(link, { metaKey: true });
  expect(opened).toHaveLength(0);
  fireEvent.click(link);
  expect(opened).toEqual([["70000001", 420]]);
  vi.useFakeTimers();
  first.unmount();
  await act(() => vi.advanceTimersByTime(5 * 60 * 1000 + 1));
  vi.useRealTimers();

  render(
    <QueryClientProvider client={queryClient}>
      <SearchPage {...props} restoreScrollOffset={420} />
    </QueryClientProvider>
  );
  await screen.findByText("26 results");
  await waitFor(() => expect(screen.getByTestId("search-results-viewport").scrollTop).toBe(420));
  const cached = queryClient.getQueryCache().findAll({ queryKey: ["marks.search"] })[0]?.state
    .data as { pages: unknown[] } | undefined;
  expect(cached?.pages).toHaveLength(2);
  expect(calls).toBe(2);
});

test("a new URL-owned search entry starts at its stored top offset", async () => {
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      if (input.status === "dead") {
        return Promise.resolve(resultPage(0, 1, 1));
      }
      return Promise.resolve(input.offset === 0 ? resultPage(0, 25, 26) : resultPage(25, 1, 26));
    },
  };
  renderSearch(api);

  await screen.findByText("26 results");
  await act(() =>
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
  await waitFor(() => expect(inputs).toHaveLength(2));
  const viewport = screen.getByTestId("search-results-viewport");
  viewport.scrollTop = 420;

  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "dead" } });

  await screen.findByText("1 result");
  await waitFor(() => expect(screen.getByTestId("search-results-viewport").scrollTop).toBe(0));
  expect(inputs.at(-1)).toMatchObject({ offset: 0, status: "dead" });
});
