import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactElement, ReactNode } from "react";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "https://example.test/search" });
if (window.location.origin === "null") window.location.href = "https://example.test/search";
Element.prototype.getAnimations ??= () => [];
const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.dataset.testid === "search-results-viewport") return new DOMRect(0, 0, 1200, 640);
  if (this.dataset.testid === "search-result-row") return new DOMRect(0, 0, 1200, 188);
  return getBoundingClientRect.call(this);
};

class TestResizeObserver implements ResizeObserver {
  private active = true;
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() { this.active = false; }
  observe(target: Element) {
    const blockSize = (target as HTMLElement).dataset.testid === "search-result-row" ? 188 : 640;
    queueMicrotask(() => {
      if (!this.active) return;
      this.callback([{
        borderBoxSize: [{ blockSize, inlineSize: 1200 }],
        contentBoxSize: [{ blockSize, inlineSize: 1200 }],
        contentRect: new DOMRectReadOnly(0, 0, 1200, blockSize),
        devicePixelContentBoxSize: [],
        target,
      }], this);
    });
  }
  unobserve() {}
}

globalThis.ResizeObserver = TestResizeObserver;

const { cloneElement } = await import("react");
const { mock, afterEach, beforeEach, expect, test } = await import("bun:test");
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

let signedIn = false;
let signInModalOpens = 0;
const searchInputs: unknown[] = [];
let searchHandler: (input: { query: string }) => Promise<typeof searchResult>;

const searchResult = {
  items: [{
    goodsServicesExcerpt: "shirts",
    internationalClasses: ["025"],
    match: "exact" as const,
    owner: "TURTLE GOODS LLC",
    registrationNumber: "7000001",
    serialNumber: "70000001",
    sourceTransactionDate: "2026-07-10",
    status: "live" as const,
    statusDate: "2026-07-09",
    type: "text" as const,
    wordMark: "TURTLE MARK",
  }],
  limit: 25 as const,
  meta: { corpusThroughDate: "2026-07-10", corpusVersion: "7" },
  offset: 0,
  total: 1,
};

const mark = {
  classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2026-07-09" }],
  goodsServices: [{ text: "shirts", typeCode: "GS0251" }],
  legalDisclaimer: "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel." as const,
  mark: {
    filingDate: "2020-01-01",
    markDrawingCode: "4",
    registrationDate: "2021-01-01",
    registrationNumber: "7000001",
    serialNumber: "70000001",
    sourceTransactionDate: "2026-07-10",
    statusCode: "700",
    statusDate: "2026-07-09",
    wordMark: "TURTLE MARK",
  },
  owners: [{ entryNumber: "1", partyName: "TURTLE GOODS LLC", partyType: "10" }],
  provenance: {
    contributors: [{
      artifactVersionSha256: "a".repeat(64),
      claimPath: "case-file/case-file-header/mark-identification",
      group: "mark-presentation" as const,
      physicalRecordIndex: 1,
      product: "TRTYRAP",
    }],
    versions: {
      authorityPolicy: "uspto-authority-v1" as const,
      normalization: "uspto-normalization-v1" as const,
      projection: "uspto-projection-v1" as const,
      sourceProfile: "uspto-application-xml-v2.0-v1" as const,
    },
  },
  statusEvents: [],
};

mock.module("@clerk/react", () => ({
  Show: ({ children, when }: { children: ReactNode; when: "signed-in" | "signed-out" }) => (
    (when === "signed-in") === signedIn ? children : null
  ),
  SignInButton: ({ children }: { children: ReactElement<{ onClick?: (event: MouseEvent) => void }> }) => (
    cloneElement(children, {
      onClick: (event: MouseEvent) => {
        signInModalOpens += 1;
        children.props.onClick?.(event);
      },
    })
  ),
  UserButton: () => null,
  useAuth: () => ({ getToken: async () => "clerk-session" }),
  useClerk: () => ({ openSignIn: () => { signInModalOpens += 1; } }),
  useSignIn: () => ({ fetchStatus: "idle", signIn: {} }),
}));

mock.module("@trpc/client", () => ({
  createTRPCClient: () => ({
    account: {
      "api-keys": {
        create: { mutate: async () => { throw new Error("not used"); } },
        list: { query: async () => [] },
        revoke: { mutate: async () => { throw new Error("not used"); } },
      },
    },
    marks: {
      get: { query: async () => mark },
      search: {
        query: async (input: unknown) => {
          searchInputs.push(input);
          return searchHandler(input as { query: string });
        },
      },
    },
  }),
  httpLink: () => ({}),
}));

const { App } = await import("../src/app.tsx");

beforeEach(() => {
  signedIn = false;
  signInModalOpens = 0;
  searchInputs.length = 0;
  searchHandler = async () => searchResult;
  window.history.replaceState({}, "", "/search");
});

afterEach(cleanup);

test("signed-out query composition survives modal sign-in before authenticated search", async () => {
  const view = render(<App />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "composed % query" },
  });
  fireEvent.submit(screen.getByRole("searchbox", { name: "Search trademarks" }).closest("form")!);

  expect(signInModalOpens).toBe(1);
  expect(new URLSearchParams(window.location.search).get("q")).toBe("composed % query");
  expect(searchInputs).toHaveLength(0);

  signedIn = true;
  view.rerender(<App />);

  await screen.findByText("TURTLE MARK");
  expect(searchInputs).toHaveLength(1);
  expect(searchInputs[0]).toMatchObject({ query: "composed % query" });
});

test("signed-out draft follows browser URL changes before sign-in", async () => {
  window.history.replaceState({}, "", "/search?q=first");
  const view = render(<App />);
  expect((screen.getByRole("searchbox", { name: "Search trademarks" }) as HTMLInputElement).value).toBe("first");

  await act(() => {
    window.history.pushState({}, "", "/search?q=second");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() => expect(
    (screen.getByRole("searchbox", { name: "Search trademarks" }) as HTMLInputElement).value,
  ).toBe("second"));

  fireEvent.submit(screen.getByRole("searchbox", { name: "Search trademarks" }).closest("form")!);
  signedIn = true;
  view.rerender(<App />);

  await screen.findByText("TURTLE MARK");
  expect(searchInputs[0]).toMatchObject({ query: "second" });
});

test("whitespace-only signed-out Enter does not navigate or open sign-in", () => {
  render(<App />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "   " },
  });
  fireEvent.submit(screen.getByRole("searchbox", { name: "Search trademarks" }).closest("form")!);

  expect(window.location.pathname).toBe("/search");
  expect(window.location.search).toBe("");
  expect(signInModalOpens).toBe(0);
  expect(searchInputs).toHaveLength(0);
});

test("direct mark entry sends Back to results to search", async () => {
  signedIn = true;
  window.history.replaceState({}, "", "/marks/70000001");
  render(<App />);

  await screen.findByRole("heading", { name: "TURTLE MARK" });
  fireEvent.click(screen.getByRole("link", { name: "← Back to results" }));

  await waitFor(() => expect(window.location.pathname).toBe("/search"));
  expect(screen.getByText("Enter one mark query to search Class 025 records.")).toBeTruthy();
});

test("search detail Back returns to the app-stored search entry", async () => {
  signedIn = true;
  window.history.replaceState(
    {},
    "",
    "/search?q=turtle&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance",
  );
  render(<App />);

  const resultLink = await screen.findByRole("link", { name: "TURTLE MARK" });
  fireEvent.click(resultLink);
  await waitFor(() => expect(window.location.pathname).toBe("/marks/70000001"));
  await screen.findByRole("heading", { name: "TURTLE MARK" });

  fireEvent.click(screen.getByRole("link", { name: "← Back to results" }));

  await waitFor(() => expect(window.location.pathname).toBe("/search"));
  expect(new URLSearchParams(window.location.search).get("q")).toBe("turtle");
  expect(await screen.findByRole("link", { name: "TURTLE MARK" })).toBeTruthy();
  expect(searchInputs).toHaveLength(1);
});

test("leaving a failed replacement clears retained results and the next failure is ordinary", async () => {
  signedIn = true;
  searchHandler = async ({ query }) => {
    if (query === "turtle") return searchResult;
    throw Object.assign(new Error("unavailable"), { data: { code: "SERVICE_UNAVAILABLE" } });
  };
  window.history.replaceState(
    {},
    "",
    "/search?q=turtle&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance",
  );
  render(<App />);

  expect(await screen.findByRole("link", { name: "TURTLE MARK" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "New search could not be loaded. Previous results are still shown.",
  );
  expect(screen.getByRole("link", { name: "TURTLE MARK" })).toBeTruthy();

  fireEvent.click(screen.getByRole("link", { name: "Trademark Turtle" }));
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(screen.getByText("Enter one mark query to search Class 025 records.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "TURTLE MARK" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();

  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "unrelated" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Search could not be loaded.");
  expect(screen.queryByRole("link", { name: "TURTLE MARK" })).toBeNull();
});

test("a failed replacement keeps its source results through detail and Back", async () => {
  signedIn = true;
  searchHandler = async ({ query }) => {
    if (query === "turtle") return searchResult;
    throw Object.assign(new Error("unavailable"), { data: { code: "SERVICE_UNAVAILABLE" } });
  };
  window.history.replaceState(
    {},
    "",
    "/search?q=turtle&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance",
  );
  render(<App />);

  expect(await screen.findByRole("link", { name: "TURTLE MARK" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "New search could not be loaded. Previous results are still shown.",
  );

  fireEvent.click(screen.getByRole("link", { name: "TURTLE MARK" }));
  await screen.findByRole("heading", { name: "TURTLE MARK" });
  fireEvent.click(screen.getByRole("link", { name: "← Back to results" }));

  await waitFor(() => expect(window.location.pathname).toBe("/search"));
  expect(new URLSearchParams(window.location.search).get("q")).toBe("replacement");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "New search could not be loaded. Previous results are still shown.",
  );
  expect(screen.getByRole("link", { name: "TURTLE MARK" })).toBeTruthy();
});

test("a successful replacement cannot revive its source during a failed same-query reset", async () => {
  signedIn = true;
  let replacementCalls = 0;
  let rejectReset: ((error: Error) => void) | undefined;
  searchHandler = async ({ query }) => {
    if (query === "turtle") {
      return {
        ...searchResult,
        items: [{ ...searchResult.items[0]!, wordMark: "SOURCE A" }],
      };
    }
    replacementCalls += 1;
    if (replacementCalls === 1) {
      return {
        ...searchResult,
        items: [{ ...searchResult.items[0]!, wordMark: "DESTINATION B" }],
      };
    }
    return new Promise((_, reject) => { rejectReset = reject; });
  };
  window.history.replaceState(
    {},
    "",
    "/search?q=turtle&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance",
  );
  render(<App />);

  expect(await screen.findByRole("link", { name: "SOURCE A" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search trademarks" }), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByRole("link", { name: "DESTINATION B" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "SOURCE A" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(rejectReset).toBeDefined());
  expect(screen.queryByRole("link", { name: "SOURCE A" })).toBeNull();
  await act(async () => rejectReset?.(Object.assign(new Error("unavailable"), {
    data: { code: "SERVICE_UNAVAILABLE" },
  })));

  expect((await screen.findByRole("alert")).textContent).toBe("Search could not be loaded.");
  expect(screen.queryByRole("link", { name: "SOURCE A" })).toBeNull();
});
