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
    return new DOMRect(0, 0, 1200, 84);
  }
  return getBoundingClientRect.call(this);
};

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { afterEach, beforeEach, expect, test, vi } = await import("bun:test");
const { useCallback, useState } = await import("react");
const { SearchPage } = await import("../src/search-page.tsx");
const { defaultSearchPreferences } = await import("../src/search-preferences.ts");
type SearchApi = import("../src/search-page.tsx").SearchApi;
type SearchPageResult = Awaited<ReturnType<SearchApi["search"]>>;
type SearchPreferences = import("../src/search-preferences.ts").SearchPreferences;

const markLinkPattern = /TURTLE MARK/;
const firstMarkAccessibleNamePattern = /TURTLE MARK 1, Live, serial number 70000001/;
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
    const blockSize = (target as HTMLElement).dataset.testid === "search-result-row" ? 84 : 640;
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
    liveMatchCounts: {
      exact: total > 0 ? 1 : 0,
      partial: Math.max(total - 1, 0),
    },
    meta: { dataVersion: "7" },
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
    preferences?: SearchPreferences;
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
          preferences={options.preferences}
          replacementSourceSearch={entry.sourceSearch}
          restoreScrollOffset={options.restoreScrollOffset ?? 0}
          search={entry.search}
        />
      </QueryClientProvider>
    );
  }
  return { queryClient, view: render(<Harness />) };
}

test("account preferences seed new search URLs, requests, and result density", async () => {
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      return Promise.resolve(resultPage(0, 1, 1));
    },
  };
  renderSearch(api, "", {
    preferences: {
      defaultMatch: "exact",
      defaultRegistered: "yes",
      defaultSort: "newest-activity",
      defaultStatus: "live",
      defaultType: "text",
      pageSize: 50,
      resultDensity: "comfortable",
    },
  });

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "turtle" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await screen.findByText("1 result");
  expect(inputs[0]).toMatchObject({
    limit: 50,
    match: "exact",
    query: "turtle",
    registered: "yes",
    sort: "newest-activity",
    status: "live",
    type: "text",
  });
  expect(screen.getByTestId("search-result-row").dataset.density).toBe("comfortable");
});

test("a cold search waits for stored preferences before navigating", async () => {
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      return Promise.resolve(resultPage(0, 1, 1));
    },
  };
  const preferences: SearchPreferences = {
    defaultMatch: "exact",
    defaultRegistered: "yes",
    defaultSort: "newest-activity",
    defaultStatus: "live",
    defaultType: "text",
    pageSize: 50,
    resultDensity: "comfortable",
  };
  const queryClient = testQueryClient();

  function Harness() {
    const [entry, setEntry] = useState({
      search: "",
      sourceSearch: undefined as string | undefined,
    });
    const [loading, setLoading] = useState(true);
    const [storedPreferences, setStoredPreferences] = useState<SearchPreferences>({
      defaultMatch: "both",
      defaultRegistered: "all",
      defaultSort: "relevance",
      defaultStatus: "all",
      defaultType: "all",
      pageSize: 25,
      resultDensity: "compact",
    });
    const resolvePreferences = useCallback(() => {
      setStoredPreferences(preferences);
      setLoading(false);
    }, []);
    const navigate = useCallback((href: string, sourceSearch?: string) => {
      const url = new URL(href, "https://example.test");
      setEntry({ search: url.search, sourceSearch });
    }, []);

    return (
      <QueryClientProvider client={queryClient}>
        <button onClick={resolvePreferences} type="button">
          Resolve preferences
        </button>
        <SearchPage
          api={api}
          onNavigate={navigate}
          onOpenMark={noop}
          onReplacementLoaded={noop}
          preferences={storedPreferences}
          preferencesLoading={loading}
          replacementSourceSearch={entry.sourceSearch}
          restoreScrollOffset={0}
          search={entry.search}
        />
      </QueryClientProvider>
    );
  }

  render(<Harness />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "turtle" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(inputs).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: "Resolve preferences" }));

  await screen.findByText("1 result");
  expect(inputs[0]).toMatchObject({
    limit: 50,
    match: "exact",
    query: "turtle",
    registered: "yes",
    sort: "newest-activity",
    status: "live",
    type: "text",
  });
});

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
    "?q=turtle&mode=multi&exact=true&partial=false&status=dead&type=design&registered=yes&sort=oldest-activity",
    {
      preferences: {
        ...defaultSearchPreferences,
        defaultRegistered: "no",
        defaultType: "text",
      },
    }
  );

  await screen.findByRole("status", { name: "No marks match “turtle”" });
  expect(screen.getByRole("group", { name: "Match" })).toBeTruthy();
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
  await screen.findByRole("status", { name: "No marks match “turtle”" });

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "new literal % query" },
  });
  expect(queries).toEqual(["turtle"]);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => expect(queries).toEqual(["turtle", "new literal % query"]));
});

test("search controls and result facts use customer-facing language", async () => {
  renderSearch({ search: () => Promise.resolve(resultPage(0, 1, 1)) });

  const searchInput = screen.getByPlaceholderText("Search a word mark") as HTMLInputElement;
  expect(searchInput.autocomplete).toBe("off");
  await screen.findByRole("link", { name: firstMarkAccessibleNamePattern });
  expect(
    screen.getByRole("heading", { name: "Trademark search results for “turtle”" })
  ).toBeTruthy();
  expect(
    within(required(screen.getByText("Live exact").parentElement, "live exact stat")).getByText("1")
  ).toBeTruthy();
  expect(
    within(required(screen.getByText("Live partial").parentElement, "live partial stat")).getByText(
      "0"
    )
  ).toBeTruthy();
  expect(screen.queryByText("Data through")).toBeNull();
  expect(screen.queryByText("Exact match")).toBeNull();
  expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
  const row = screen.getByTestId("search-result-row");
  expect(within(row).getByText("Text")).toBeTruthy();
  expect(within(row).queryByText("IC 025")).toBeNull();
  expect(within(row).queryByText("SN 70000001")).toBeNull();
  expect(within(row).queryByText("shirts and sweatshirts")).toBeNull();
  expect(row.querySelector(".result-status")).toBeNull();
  expect(row.querySelector('[data-slot="result-status"][data-status="live"]')).toBeTruthy();
  expect(row.querySelector('[data-slot="result-main"]')).toBeTruthy();
  expect(row.querySelector('[data-slot="result-meta"]')).toBeTruthy();
  expect(screen.getByRole("list", { name: "Trademark results" })).toBeTruthy();
  expect(screen.getByRole("listitem")).toBe(row);
  expect(row.getAttribute("aria-posinset")).toBe("1");
  expect(row.getAttribute("aria-setsize")).toBe("1");
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
  expect(await screen.findByRole("link", { name: firstMarkAccessibleNamePattern })).toBeTruthy();

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => expect(rejectReplacement).toBeDefined());
  expect(screen.getByRole("link", { name: firstMarkAccessibleNamePattern })).toBeTruthy();
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
  expect(screen.getByRole("link", { name: firstMarkAccessibleNamePattern })).toBeTruthy();
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
  expect(screen.getByRole("searchbox", { name: "Search trademarks" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Filters and sort" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Search options" })).toBeNull();
  expect(inputs).toHaveLength(0);
  whitespace.view.unmount();

  renderSearch(api, "?q=turtle&mode=multi&exact=false&partial=false");
  await screen.findByRole("status", { name: "No marks match “turtle”" });
  expect(inputs[0]?.match).toBe("partial");
  expect((screen.getByRole("checkbox", { name: "Partial" }) as HTMLInputElement).checked).toBe(
    true
  );
});

test("an empty filtered search stays graphical and leaves filters in place", async () => {
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  renderSearch(
    {
      search: (input) => {
        inputs.push(input);
        return Promise.resolve(resultPage(0, 0, 0));
      },
    },
    "?q=turtle&mode=multi&exact=true&partial=true&status=dead&type=design&registered=no&sort=oldest-activity"
  );

  await screen.findByRole("status", { name: "No marks match “turtle”" });
  expect(screen.getByText("0 results")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Broaden search" })).toBeNull();
  expect(inputs).toHaveLength(1);
});

test("does not announce retained empty results for a replacement query", async () => {
  let resolveReplacement: ((page: SearchPageResult) => void) | undefined;
  const inputs: Parameters<SearchApi["search"]>[0][] = [];
  const api: SearchApi = {
    search: (input) => {
      inputs.push(input);
      if (input.query === "turtle") {
        return Promise.resolve(resultPage(0, 0, 0));
      }
      return new Promise<SearchPageResult>((resolve) => {
        resolveReplacement = resolve;
      });
    },
  };
  renderSearch(api);
  await screen.findByRole("status", { name: "No marks match “turtle”" });

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => expect(inputs).toHaveLength(2));
  expect(screen.queryByRole("status", { name: "No marks match “replacement”" })).toBeNull();
  expect(screen.queryByText("0 results")).toBeNull();

  await act(async () => {
    resolveReplacement?.(resultPage(0, 0, 0));
    await Promise.resolve();
  });
  expect(await screen.findByRole("status", { name: "No marks match “replacement”" })).toBeTruthy();
});

test("infinite pagination pins data version and keeps the document list virtualized", async () => {
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
  expect(screen.queryByTestId("search-results-viewport")).toBeNull();
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
  expect(await screen.findByRole("status", { name: "No marks match “turtle”" })).toBeTruthy();
  loading.view.unmount();

  const serverError = Object.assign(new Error("database unavailable"), {
    data: { code: "INTERNAL_SERVER_ERROR" },
  });
  renderSearch({
    search: () => Promise.reject(serverError),
  });
  expect((await screen.findByRole("alert")).textContent).toBe("Search could not be loaded.");
  cleanup();

  const corpusBuilding = Object.assign(new Error("corpus unavailable"), {
    data: { code: "SERVICE_UNAVAILABLE" },
  });
  renderSearch({
    search: () => Promise.reject(corpusBuilding),
  });
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Search is temporarily unavailable. Try again shortly."
  );
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

test("the query cache and browser entry restore loaded pages and document scroll after detail", async () => {
  let calls = 0;
  let documentScroll = 0;
  const opened: [string, number][] = [];
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => documentScroll,
  });
  window.scrollTo = ((_x: number, y: number) => {
    documentScroll = y;
  }) as typeof window.scrollTo;
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
  documentScroll = 420;
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
  documentScroll = 0;
  await act(() => vi.advanceTimersByTime(5 * 60 * 1000 + 1));
  vi.useRealTimers();

  render(
    <QueryClientProvider client={queryClient}>
      <SearchPage {...props} restoreScrollOffset={420} />
    </QueryClientProvider>
  );
  await screen.findByText("26 results");
  await waitFor(() => expect(window.scrollY).toBe(420));
  const cached = queryClient.getQueryCache().findAll({ queryKey: ["marks.search"] })[0]?.state
    .data as { pages: unknown[] } | undefined;
  expect(cached?.pages).toHaveLength(2);
  expect(calls).toBe(2);
});

test("a new URL-owned search entry starts at the top of the document", async () => {
  let documentScroll = 0;
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => documentScroll,
  });
  window.scrollTo = ((_x: number, y: number) => {
    documentScroll = y;
  }) as typeof window.scrollTo;
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
  documentScroll = 420;

  fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Dead" }));

  await screen.findByText("1 result");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Status: Dead" }).getAttribute("aria-expanded")).toBe(
      "false"
    )
  );
  await waitFor(() => expect(window.scrollY).toBe(0));
  expect(inputs.at(-1)).toMatchObject({ offset: 0, status: "dead" });
});
