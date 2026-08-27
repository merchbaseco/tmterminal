import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactElement, ReactNode } from "react";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "https://example.test/search" });
}
if (window.location.origin === "null") {
  window.location.href = "https://example.test/search";
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

class TestResizeObserver implements ResizeObserver {
  private callback: ResizeObserverCallback | undefined;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  disconnect() {
    this.callback = undefined;
  }
  observe(target: Element) {
    const blockSize = (target as HTMLElement).dataset.testid === "search-result-row" ? 84 : 640;
    queueMicrotask(() => {
      if (!this.callback) {
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
    // Individual observations are not retained by this test double.
  }
}

globalThis.ResizeObserver = TestResizeObserver;

const { cloneElement } = await import("react");
const { mock, afterEach, beforeEach, expect, test } = await import("bun:test");
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const defaultMatchMedia = window.matchMedia;

let signedIn = false;
let operator = false;
let signInModalOpens = 0;
let userProfileModalOpens = 0;
const signOutRedirects: (string | undefined)[] = [];
let scrollOffset = 0;
const searchInputs: unknown[] = [];
let searchHandler: (input: { query: string }) => Promise<typeof searchResult>;
const destinationMarkLinkPattern = /DESTINATION B/;
const getTestToken = async () => "clerk-session";
const sourceMarkLinkPattern = /SOURCE A/;
const terminalMarkLinkPattern = /TERMINAL MARK, Live, serial number 70000001/;

Object.defineProperty(window, "scrollY", {
  configurable: true,
  get: () => scrollOffset,
});
window.scrollTo = ((_x: number, y: number) => {
  scrollOffset = y;
}) as typeof window.scrollTo;

const searchItem = {
  goodsServicesExcerpt: "shirts",
  internationalClasses: ["025"],
  match: "exact" as const,
  owner: "TERMINAL GOODS LLC",
  registrationNumber: "7000001",
  serialNumber: "70000001",
  sourceTransactionDate: "2026-07-10",
  status: "live" as const,
  statusDate: "2026-07-09",
  type: "text" as const,
  wordMark: "TERMINAL MARK",
};
const searchResult = {
  items: [searchItem],
  limit: 25 as const,
  liveMatchCounts: { exact: 1, partial: 0 },
  meta: { dataVersion: "7" },
  offset: 0,
  total: 1,
};
const mark = {
  classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2026-07-09" }],
  goodsServices: [{ text: "shirts", typeCode: "GS0251" }],
  legalDisclaimer:
    "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel." as const,
  mark: {
    filingDate: "2020-01-01",
    markDrawingCode: "4",
    registrationDate: "2021-01-01",
    registrationNumber: "7000001",
    serialNumber: "70000001",
    sourceTransactionDate: "2026-07-10",
    status: "live" as const,
    statusCode: "700",
    statusDate: "2026-07-09",
    wordMark: "TERMINAL MARK",
  },
  owners: [{ entryNumber: "1", partyName: "TERMINAL GOODS LLC", partyType: "10" }],
  provenance: {
    contributors: [
      {
        artifactVersionSha256: "a".repeat(64),
        claimPath: "case-file/case-file-header/mark-identification",
        group: "mark-presentation" as const,
        physicalRecordIndex: 1,
        product: "TRTYRAP",
      },
    ],
    versions: {
      authorityPolicy: "uspto-authority-v1" as const,
      normalization: "uspto-normalization-v1" as const,
      projection: "uspto-projection-v2" as const,
      sourceProfile: "uspto-application-xml-v2.0-v1" as const,
    },
  },
  statusEvents: [],
  type: "text" as const,
};

const statusResult = {
  catalog: {
    earliestFilingDate: "1895-04-01",
    totalMarkCount: 1_200_000,
  },
  source: {
    applicationActivity: Array.from({ length: 30 }, (_, index) => ({
      applicationUpdates: index * 1000,
      date: new Date(Date.UTC(2026, 5, 19 + index)).toISOString().slice(0, 10),
      newApplications: index * 10,
    })),
    currentArtifact: null,
    lastActivityAt: "2026-07-18T12:00:00.000Z",
    latestProcessedDate: "2026-07-18",
  },
};

mock.module("@clerk/react", () => ({
  Show: ({ children, when }: { children: ReactNode; when: "signed-in" | "signed-out" }) =>
    (when === "signed-in") === signedIn ? children : null,
  SignInButton: ({
    children,
  }: {
    children: ReactElement<{ onClick?: (event: MouseEvent) => void }>;
  }) =>
    cloneElement(children, {
      onClick: (event: MouseEvent) => {
        signInModalOpens += 1;
        children.props.onClick?.(event);
      },
    }),
  useAuth: () => ({ getToken: getTestToken }),
  useClerk: () => ({
    openSignIn: () => {
      signInModalOpens += 1;
    },
    openUserProfile: () => {
      userProfileModalOpens += 1;
    },
    signOut: ({ redirectUrl }: { redirectUrl?: string } = {}) => {
      signOutRedirects.push(redirectUrl);
      return Promise.resolve();
    },
  }),
  useSignIn: () => ({ fetchStatus: "idle", signIn: {} }),
  useUser: () => ({
    user: {
      firstName: "Zach",
      fullName: "Zach Knickerbocker",
      imageUrl: "https://example.test/zach.png",
      primaryEmailAddress: { emailAddress: "zach@example.com" },
    },
  }),
}));

mock.module("@trpc/client", () => ({
  createTRPCClient: () => ({
    account: {
      preferences: {
        get: {
          query: async () => ({
            defaultMatch: "both" as const,
            defaultRegistered: "all" as const,
            defaultSort: "relevance" as const,
            defaultStatus: "all" as const,
            defaultType: "all" as const,
            pageSize: 25 as const,
            resultDensity: "compact" as const,
          }),
        },
        update: {
          mutate: async (preferences: unknown) => preferences,
        },
      },
    },
    marks: {
      get: { query: () => Promise.resolve(mark) },
      match: {
        query: async () => ({
          meta: { dataVersion: "7" },
          texts: [],
        }),
      },
      screen: {
        query: async () => ({
          meta: { dataVersion: "7" },
          queries: [],
        }),
      },
      search: {
        query: (input: unknown) => {
          searchInputs.push(input);
          return searchHandler(input as { query: string });
        },
      },
    },
    ops: {
      sync: {
        artifacts: {
          query: async () => ({
            counts: { all: 0, needsAttention: 0 },
            items: [],
            limit: 25,
            offset: 0,
            total: 0,
          }),
        },
        status: {
          query: async () => ({
            ...statusResult,
            attention: { items: [], total: 0 },
            provider: { status: "ready" as const },
          }),
        },
      },
    },
    viewer: { role: { query: async () => ({ operator }) } },
  }),
  httpLink: () => ({}),
}));

const { App } = await import("../src/app.tsx");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  signedIn = false;
  operator = false;
  signInModalOpens = 0;
  userProfileModalOpens = 0;
  signOutRedirects.length = 0;
  scrollOffset = 0;
  searchInputs.length = 0;
  searchHandler = () => Promise.resolve(searchResult);
  globalThis.fetch = mock(async () =>
    Response.json(statusResult, { headers: { "Content-Type": "application/json" } })
  ) as unknown as typeof fetch;
  window.history.replaceState({}, "", "/search");
});

afterEach(() => {
  window.matchMedia = defaultMatchMedia;
  cleanup();
});

test("appearance initializes before the application module", async () => {
  const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
  const appearanceInitialization = html.indexOf('localStorage.getItem("tmterminal-appearance")');

  expect(appearanceInitialization).toBeGreaterThan(-1);
  expect(appearanceInitialization).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
});

test("appearance follows the system initially and persists an explicit choice", async () => {
  signedIn = true;
  render(<App />);

  const accountMenu = screen.getByRole("button", {
    name: "Account menu for Zach Knickerbocker",
  });
  expect(document.documentElement.classList.contains("dark")).toBe(false);

  fireEvent.click(accountMenu);
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Dark" }));

  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  expect(localStorage.getItem("tmterminal-appearance")).toBe("dark");

  cleanup();
  document.documentElement.classList.remove("dark");
  render(<App />);
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
});

test("system appearance follows a dark system preference", async () => {
  signedIn = true;
  window.matchMedia = ((query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => true,
    matches: true,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;

  render(<App />);

  expect(screen.getByRole("button", { name: "Account menu for Zach Knickerbocker" })).toBeTruthy();
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
});

test("signed-out system appearance follows preference changes", async () => {
  let systemDark = false;
  let listener: (() => void) | undefined;
  window.matchMedia = ((query: string) => ({
    addEventListener: (_event: string, nextListener: () => void) => {
      listener = nextListener;
    },
    addListener: () => undefined,
    dispatchEvent: () => true,
    get matches() {
      return systemDark;
    },
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;

  render(<App />);
  expect(document.documentElement.classList.contains("dark")).toBe(false);

  systemDark = true;
  listener?.();

  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
});

test("account menu owns identity, account management, appearance, and sign out", async () => {
  signedIn = true;
  render(<App />);

  const accountMenu = screen.getByRole("button", {
    name: "Account menu for Zach Knickerbocker",
  });
  fireEvent.click(accountMenu);

  expect(await screen.findByText("Zach Knickerbocker")).toBeTruthy();
  expect(screen.getByText("zach@example.com")).toBeTruthy();
  expect(screen.getByRole("menuitemradio", { name: "Light" })).toBeTruthy();
  expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeTruthy();
  expect(screen.getByRole("menuitemradio", { name: "System" })).toBeTruthy();

  fireEvent.click(screen.getByRole("menuitem", { name: "Manage account" }));
  expect(userProfileModalOpens).toBe(1);

  fireEvent.click(accountMenu);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
  await waitFor(() => expect(signOutRedirects).toEqual(["/search"]));
});

test("signed-out search offers only the mark composer", () => {
  render(<App />);

  expect(screen.getByRole("searchbox", { name: "Search trademarks" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Check text" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Bulk check" })).toBeNull();
});

test("signed-out query composition survives modal sign-in before authenticated search", async () => {
  const view = render(<App />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "composed % query" },
  });
  fireEvent.submit(searchForm());

  expect(signInModalOpens).toBe(1);
  expect(new URLSearchParams(window.location.search).get("q")).toBe("composed % query");
  expect(searchInputs).toHaveLength(0);

  signedIn = true;
  view.rerender(<App />);

  await screen.findByText("TERMINAL MARK");
  expect(searchInputs).toHaveLength(1);
  expect(searchInputs[0]).toMatchObject({ query: "composed % query" });
});

test("signed-out draft follows browser URL changes before sign-in", async () => {
  window.history.replaceState({}, "", "/search?q=first");
  const view = render(<App />);
  expect(
    (screen.getByRole("searchbox", { name: "Search trademarks" }) as HTMLInputElement).value
  ).toBe("first");

  await act(() => {
    window.history.pushState({}, "", "/search?q=second");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("searchbox", { name: "Search trademarks" }) as HTMLInputElement).value
    ).toBe("second")
  );

  fireEvent.submit(searchForm());
  signedIn = true;
  view.rerender(<App />);

  await screen.findByText("TERMINAL MARK");
  expect(searchInputs[0]).toMatchObject({ query: "second" });
});

test("whitespace-only signed-out Enter does not navigate or open sign-in", () => {
  render(<App />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "   " },
  });
  fireEvent.submit(searchForm());

  expect(window.location.pathname).toBe("/search");
  expect(window.location.search).toBe("");
  expect(signInModalOpens).toBe(0);
  expect(searchInputs).toHaveLength(0);
});

test("the shared search composer switches between search, text, and bulk modes", async () => {
  signedIn = true;
  render(<App />);

  const searchField = screen.getByRole("searchbox", { name: "Search trademarks" });
  const searchAction = screen.getByRole("button", { name: "Search" }) as HTMLButtonElement;
  expect(searchAction.disabled).toBe(false);
  fireEvent.click(searchAction);
  expect(screen.getByRole("button", { name: "Give me a word" })).toBeTruthy();
  expect(document.activeElement).toBe(searchField);

  fireEvent.click(screen.getByRole("link", { name: "Check text" }));
  await waitFor(() => expect(window.location.pathname).toBe("/check"));
  expect(screen.getByRole("textbox", { name: "Text to check" })).toBeTruthy();

  fireEvent.click(screen.getByRole("link", { name: "Bulk check" }));
  await waitFor(() => expect(window.location.pathname).toBe("/bulk"));
  expect(screen.getByRole("textbox", { name: "Phrases to check" })).toBeTruthy();

  fireEvent.click(screen.getByRole("link", { name: "Search marks" }));
  await waitFor(() => expect(window.location.pathname).toBe("/search"));
  expect(screen.getByRole("searchbox", { name: "Search trademarks" })).toBeTruthy();
});

test("direct mark entry sends Back to results to search", async () => {
  signedIn = true;
  window.history.replaceState({}, "", "/marks/70000001");
  render(<App />);

  await screen.findByRole("heading", { name: "TERMINAL MARK" });
  fireEvent.click(screen.getByRole("link", { name: "Back to results" }));

  await waitFor(() => expect(window.location.pathname).toBe("/search"));
  expect(screen.getByRole("searchbox", { name: "Search trademarks" })).toBeTruthy();
});

test("search detail Back returns to the app-stored search entry", async () => {
  signedIn = true;
  window.history.replaceState(
    {},
    "",
    "/search?q=terminal&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance"
  );
  render(<App />);

  const resultLink = await screen.findByRole("link", { name: terminalMarkLinkPattern });
  expect(screen.queryByRole("link", { name: "Search marks" })).toBeNull();
  expect(screen.getByRole("button", { name: "Start a new search" })).toBeTruthy();
  fireEvent.click(resultLink);
  await waitFor(() => expect(window.location.pathname).toBe("/marks/70000001"));
  await screen.findByRole("heading", { name: "TERMINAL MARK" });

  fireEvent.click(screen.getByRole("link", { name: "Back to results" }));

  await waitFor(() => expect(window.location.pathname).toBe("/search"));
  expect(new URLSearchParams(window.location.search).get("q")).toBe("terminal");
  expect(await screen.findByRole("link", { name: terminalMarkLinkPattern })).toBeTruthy();
  expect(searchInputs).toHaveLength(1);
});

test("compact menu exposes primary navigation on small screens", async () => {
  signedIn = true;
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  const currentSearchItem = await screen.findByRole("menuitem", { name: "Search" });
  expect(currentSearchItem.getAttribute("aria-current")).toBe("page");
  expect(currentSearchItem.className.split(" ")).toContain("bg-accent");
  expect(screen.queryByRole("menuitem", { name: "Filed previous week" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Published for opposition" })).toBeNull();
  const accountItem = screen.getByRole("menuitem", { name: "Account" });
  expect(accountItem.getAttribute("aria-current")).toBeNull();
  expect(accountItem.className.split(" ")).not.toContain("bg-accent");

  fireEvent.click(screen.getByRole("menuitem", { name: "Status" }));
  await waitFor(() => expect(window.location.pathname).toBe("/status"));
  expect(await screen.findByRole("heading", { name: "Status" })).toBeTruthy();
});

test("shows public Status and Docs without exposing operator sections", async () => {
  render(<App />);

  fireEvent.click(screen.getByRole("link", { name: "Status" }));
  expect(await screen.findByRole("heading", { name: "Status" })).toBeTruthy();
  expect(await screen.findByText("1,200,000")).toBeTruthy();
  expect(screen.queryByText("Needs attention")).toBeNull();
  expect(screen.queryByText("Source files")).toBeNull();

  const docs = screen.getByRole("link", { name: "Docs" });
  expect(docs.getAttribute("href")).toBe("/docs/");
});

test("shows operator details on the shared Status page", async () => {
  signedIn = true;
  operator = true;
  window.history.replaceState({}, "", "/status");
  render(<App />);

  expect(await screen.findByRole("button", { name: "Errors: 0" })).toBeTruthy();
  expect(screen.getByText("Source files")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Status" }).getAttribute("aria-current")).toBe("page");
});

test("Account navigation links to suite-wide API-key management", async () => {
  signedIn = true;
  render(<App />);

  scrollOffset = 320;
  fireEvent.click(screen.getByRole("link", { name: "Account" }));

  await waitFor(() => expect(window.location.pathname).toBe("/account"));
  expect(scrollOffset).toBe(0);
  expect(await screen.findByRole("heading", { level: 1, name: "ACCOUNT" })).toBeTruthy();
  expect(screen.queryByText("zach@example.com")).toBeNull();
  expect(screen.getByRole("link", { name: "Manage API keys" }).getAttribute("href")).toBe(
    "https://merchbase.co/account/api-keys/"
  );
  expect(screen.getByRole("link", { name: "Account" }).getAttribute("aria-current")).toBe("page");
});

test("leaving a failed replacement clears retained results and the next failure is ordinary", async () => {
  signedIn = true;
  searchHandler = ({ query }) => {
    if (query === "terminal") {
      return Promise.resolve(searchResult);
    }
    return Promise.reject(
      Object.assign(new Error("unavailable"), { data: { code: "SERVICE_UNAVAILABLE" } })
    );
  };
  window.history.replaceState(
    {},
    "",
    "/search?q=terminal&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance"
  );
  render(<App />);

  expect(await screen.findByRole("link", { name: terminalMarkLinkPattern })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "New search could not be loaded. Previous results are still shown."
  );
  expect(screen.getByRole("link", { name: terminalMarkLinkPattern })).toBeTruthy();

  fireEvent.click(screen.getByRole("link", { name: "Trademark Terminal home" }));
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(screen.getByRole("searchbox", { name: "Search trademarks" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: terminalMarkLinkPattern })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "unrelated" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Search is temporarily unavailable. Try again shortly."
  );
  expect(screen.queryByRole("link", { name: terminalMarkLinkPattern })).toBeNull();
});

test("a failed replacement keeps its source results through detail and Back", async () => {
  signedIn = true;
  searchHandler = ({ query }) => {
    if (query === "terminal") {
      return Promise.resolve(searchResult);
    }
    return Promise.reject(
      Object.assign(new Error("unavailable"), { data: { code: "SERVICE_UNAVAILABLE" } })
    );
  };
  window.history.replaceState(
    {},
    "",
    "/search?q=terminal&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance"
  );
  render(<App />);

  expect(await screen.findByRole("link", { name: terminalMarkLinkPattern })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "New search could not be loaded. Previous results are still shown."
  );

  fireEvent.click(screen.getByRole("link", { name: terminalMarkLinkPattern }));
  await screen.findByRole("heading", { name: "TERMINAL MARK" });
  fireEvent.click(screen.getByRole("link", { name: "Back to results" }));

  await waitFor(() => expect(window.location.pathname).toBe("/search"));
  expect(new URLSearchParams(window.location.search).get("q")).toBe("replacement");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "New search could not be loaded. Previous results are still shown."
  );
  expect(screen.getByRole("link", { name: terminalMarkLinkPattern })).toBeTruthy();
});

test("a successful replacement cannot revive its source during a failed same-query reset", async () => {
  signedIn = true;
  let replacementCalls = 0;
  let rejectReset: ((error: Error) => void) | undefined;
  searchHandler = ({ query }) => {
    if (query === "terminal") {
      return Promise.resolve({
        ...searchResult,
        items: [{ ...searchItem, wordMark: "SOURCE A" }],
      });
    }
    replacementCalls += 1;
    if (replacementCalls === 1) {
      return Promise.resolve({
        ...searchResult,
        items: [{ ...searchItem, wordMark: "DESTINATION B" }],
      });
    }
    return new Promise((_, reject) => {
      rejectReset = reject;
    });
  };
  window.history.replaceState(
    {},
    "",
    "/search?q=terminal&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance"
  );
  render(<App />);

  expect(await screen.findByRole("link", { name: sourceMarkLinkPattern })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByRole("link", { name: destinationMarkLinkPattern })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "SOURCE A" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(rejectReset).toBeDefined());
  expect(screen.queryByRole("link", { name: "SOURCE A" })).toBeNull();
  await act(async () =>
    rejectReset?.(
      Object.assign(new Error("unavailable"), {
        data: { code: "SERVICE_UNAVAILABLE" },
      })
    )
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Search is temporarily unavailable. Try again shortly."
  );
  expect(screen.queryByRole("link", { name: "SOURCE A" })).toBeNull();
});

function searchForm() {
  const form = screen.getByRole("searchbox", { name: "Search trademarks" }).closest("form");
  if (!form) {
    throw new Error("Search form not found");
  }
  return form;
}
