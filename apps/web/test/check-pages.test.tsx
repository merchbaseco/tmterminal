import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { BulkCheckPage } = await import("../src/bulk-check-page.tsx");
const { CheckTextPage } = await import("../src/check-text-page.tsx");
type BulkCheckApi = import("../src/bulk-check-page.tsx").BulkCheckApi;
type TextCheckApi = import("../src/check-text-page.tsx").TextCheckApi;

const trademark = {
  goodsServicesExcerpt: "shirts",
  internationalClasses: ["025"],
  owner: "TURTLE GOODS LLC",
  registrationNumber: "7000001",
  serialNumber: "70000001",
  sourceTransactionDate: "2026-07-10",
  status: "live" as const,
  statusDate: "2026-07-09",
  type: "text" as const,
  wordMark: "TURTLE CLUB",
};
const shirtsTrademark = {
  ...trademark,
  owner: "SHIRTS LLC",
  registrationNumber: "7000002",
  serialNumber: "70000002",
  wordMark: "SHIRTS",
};
const ignoreNavigation = () => undefined;

afterEach(cleanup);

test("checks text, filters from its highlight, and opens a canonical result row", async () => {
  const inputs: Parameters<TextCheckApi["match"]>[0][] = [];
  const opened: string[] = [];
  const restoreStates: unknown[] = [];
  const onOpenMark = (serialNumber: string, _scrollOffset: number, restoreState: unknown) => {
    opened.push(serialNumber);
    restoreStates.push(restoreState);
  };
  const api: TextCheckApi = {
    match: (input) => {
      inputs.push(input);
      return Promise.resolve({
        meta: { dataVersion: "7" },
        texts: [
          {
            id: "text",
            matches: [
              { end: 11, start: 0, trademarks: [trademark] },
              { end: 18, start: 12, trademarks: [shirtsTrademark] },
            ],
            text: "Turtle Club shirts",
          },
        ],
      });
    },
  };

  const view = renderPage(
    <CheckTextPage api={api} onNavigate={ignoreNavigation} onOpenMark={onOpenMark} />
  );
  const textField = screen.getByLabelText("Text to check");
  expect(textField.tagName).toBe("INPUT");
  fireEvent.click(screen.getByRole("button", { name: "Check text" }));
  expect(screen.getByRole("button", { name: "Paste some text" })).toBeTruthy();
  expect(document.activeElement).toBe(textField);
  fireEvent.change(textField, {
    target: { value: "Turtle Club shirts" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check text" }));

  const highlight = await screen.findByRole("button", {
    name: "Turtle Club, 1 matching trademark",
  });
  expect(highlight).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Search marks" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check different text" })).toBeTruthy();
  const shirtsHighlight = screen.getByRole("button", {
    name: "shirts, 1 matching trademark",
  });
  expect(highlight.getAttribute("data-tone")).toBe("lime");
  expect(shirtsHighlight.getAttribute("data-tone")).toBe("cyan");
  expect(view.container.querySelector('[data-slot="result-summary"]')?.textContent).toBe(
    "2 trademarks2Live exact0Live partial"
  );
  expect(view.container.querySelectorAll('[data-tone="lime"]').length).toBeGreaterThanOrEqual(2);
  expect(
    screen.getByRole("link", {
      name: "TURTLE CLUB, Live, serial number 70000001",
    })
  ).toBeTruthy();
  expect(inputs).toEqual([
    {
      texts: [{ id: "text", text: "Turtle Club shirts" }],
      type: "all",
    },
  ]);
  fireEvent.click(highlight);
  expect(highlight.getAttribute("aria-pressed")).toBe("true");
  fireEvent.change(textField, {
    target: { value: "Unsubmitted draft" },
  });
  fireEvent.click(
    screen.getByRole("link", {
      name: "TURTLE CLUB, Live, serial number 70000001",
    })
  );
  expect(opened).toEqual(["70000001"]);
  expect(restoreStates).toEqual([{ kind: "text", text: "Turtle Club shirts" }]);

  fireEvent.click(screen.getByRole("button", { name: "Check different text" }));
  expect((screen.getByLabelText("Text to check") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("link", { name: "Search marks" })).toBeTruthy();
});

test("screens named phrases and shows canonical results for the selected phrase", async () => {
  const inputs: Parameters<BulkCheckApi["screen"]>[0][] = [];
  const searches: Parameters<BulkCheckApi["search"]>[0][] = [];
  const opened: string[] = [];
  const restoreStates: unknown[] = [];
  const onOpenMark = (serialNumber: string, _scrollOffset: number, restoreState: unknown) => {
    opened.push(serialNumber);
    restoreStates.push(restoreState);
  };
  const api: BulkCheckApi = {
    screen: (input) => {
      inputs.push(input);
      return Promise.resolve({
        meta: { dataVersion: "7" },
        queries: [
          {
            id: "line-1",
            liveMatches: { exact: 1, partial: 2 },
            query: "Turtle Club",
          },
          {
            id: "line-2",
            liveMatches: { exact: 0, partial: 0 },
            query: "Ocean Supply",
          },
        ],
      });
    },
    search: (input) => {
      searches.push(input);
      const matched = input.query === "Turtle Club";
      return Promise.resolve({
        items: matched ? [{ ...trademark, match: "exact" as const }] : [],
        limit: 25,
        liveMatchCounts: {
          exact: matched ? 1 : 0,
          partial: matched ? 2 : 0,
        },
        meta: { dataVersion: "7" },
        offset: 0,
        total: matched ? 1 : 0,
      });
    },
  };

  renderPage(<BulkCheckPage api={api} onNavigate={ignoreNavigation} onOpenMark={onOpenMark} />);
  const phrasesField = screen.getByLabelText("Phrases to check");
  expect(phrasesField.tagName).toBe("TEXTAREA");
  expect(
    phrasesField.closest("[data-action-placement]")?.getAttribute("data-action-placement")
  ).toBe("below");
  fireEvent.change(phrasesField, {
    target: { value: "Turtle Club\nOcean Supply" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Bulk check" }));

  const matchedPhrase = await screen.findByRole("button", {
    name: "Turtle Club, 3 live matches",
  });
  expect(matchedPhrase.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("link", { name: "Search marks" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check different phrases" })).toBeTruthy();
  expect(inputs[0]).toEqual({
    queries: [
      { id: "line-1", query: "Turtle Club" },
      { id: "line-2", query: "Ocean Supply" },
    ],
    type: "all",
  });
  const resultLink = await screen.findByRole("link", {
    name: "TURTLE CLUB, Live, serial number 70000001",
  });
  expect(searches[0]?.query).toBe("Turtle Club");
  expect(searches[0]?.expectedDataVersion).toBe("7");
  fireEvent.change(phrasesField, {
    target: { value: "Unsubmitted draft" },
  });
  fireEvent.click(resultLink);
  expect(opened).toEqual(["70000001"]);
  expect(restoreStates).toEqual([
    {
      kind: "bulk",
      selectedQueryId: "line-1",
      value: "Turtle Club\nOcean Supply",
    },
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Ocean Supply, no live matches" }));
  expect(await screen.findByText("No live matches")).toBeTruthy();
  expect(
    screen.getByText("No exact or partial live word marks matched “Ocean Supply”.")
  ).toBeTruthy();
  expect(searches.at(-1)?.query).toBe("Ocean Supply");

  fireEvent.click(screen.getByRole("button", { name: "Check different phrases" }));
  expect((screen.getByLabelText("Phrases to check") as HTMLTextAreaElement).value).toBe("");
  expect(screen.getByRole("link", { name: "Search marks" })).toBeTruthy();
});

test("restores submitted check tools after returning from trademark detail", async () => {
  const matchInputs: Parameters<TextCheckApi["match"]>[0][] = [];
  const screenInputs: Parameters<BulkCheckApi["screen"]>[0][] = [];
  const textApi: TextCheckApi = {
    match: (input) => {
      matchInputs.push(input);
      return Promise.resolve({
        meta: { dataVersion: "7" },
        texts: [{ id: "text", matches: [], text: input.texts[0]?.text ?? "" }],
      });
    },
  };
  const bulkApi: BulkCheckApi = {
    screen: (input) => {
      screenInputs.push(input);
      return Promise.resolve({
        meta: { dataVersion: "7" },
        queries: input.queries.map((query) => ({
          ...query,
          liveMatches: { exact: 0, partial: 0 },
        })),
      });
    },
    search: () => Promise.reject(new Error("No selected phrase has matches")),
  };
  const onOpenMark = () => undefined;
  const scrollOffsets: number[] = [];
  const originalScrollTo = window.scrollTo;
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: (_x: number, y: number) => {
      scrollOffsets.push(Number(y));
    },
  });

  try {
    const textView = renderPage(
      <CheckTextPage
        api={textApi}
        initialState={{ kind: "text", text: "Restored title" }}
        onNavigate={ignoreNavigation}
        onOpenMark={onOpenMark}
        restoreScrollOffset={240}
      />
    );
    expect(await screen.findByText("No live matches")).toBeTruthy();
    const restoredText = screen.getByLabelText("Text to check") as HTMLInputElement;
    expect(restoredText.value).toBe("Restored title");
    expect(matchInputs).toEqual([{ texts: [{ id: "text", text: "Restored title" }], type: "all" }]);
    fireEvent.change(restoredText, { target: { value: "Second title" } });
    fireEvent.click(screen.getByRole("button", { name: "Check text" }));
    await screen.findByText("No live matches");
    expect(scrollOffsets).toEqual([240]);
    textView.unmount();

    renderPage(
      <BulkCheckPage
        api={bulkApi}
        initialState={{
          kind: "bulk",
          selectedQueryId: "line-2",
          value: "First phrase\nSecond phrase",
        }}
        onNavigate={ignoreNavigation}
        onOpenMark={onOpenMark}
        restoreScrollOffset={320}
      />
    );
    const restoredPhrase = await screen.findByRole("button", {
      name: "Second phrase, no live matches",
    });
    expect(restoredPhrase.getAttribute("aria-pressed")).toBe("true");
    const restoredPhrases = screen.getByLabelText("Phrases to check") as HTMLTextAreaElement;
    expect(restoredPhrases.value).toBe("First phrase\nSecond phrase");
    expect(screenInputs).toEqual([
      {
        queries: [
          { id: "line-1", query: "First phrase" },
          { id: "line-2", query: "Second phrase" },
        ],
        type: "all",
      },
    ]);
    fireEvent.change(restoredPhrases, { target: { value: "Third phrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Bulk check" }));
    await screen.findByRole("button", { name: "Third phrase, no live matches" });
    expect(scrollOffsets).toEqual([240, 320]);
  } finally {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: originalScrollTo,
    });
  }
});

test("refreshes screening when pinned bulk results conflict", async () => {
  let dataVersion = "7";
  const screenInputs: Parameters<BulkCheckApi["screen"]>[0][] = [];
  const api: BulkCheckApi = {
    screen: (input) => {
      screenInputs.push(input);
      return Promise.resolve({
        meta: { dataVersion },
        queries: [
          {
            id: "line-1",
            liveMatches: { exact: 1, partial: 0 },
            query: "Turtle Club",
          },
        ],
      });
    },
    search: (input) =>
      input.expectedDataVersion === "7"
        ? Promise.reject({ data: { code: "CONFLICT" } })
        : Promise.resolve({
            items: [{ ...trademark, match: "exact" as const }],
            limit: 25,
            liveMatchCounts: { exact: 1, partial: 0 },
            meta: { dataVersion: "8" },
            offset: 0,
            total: 1,
          }),
  };
  const onOpenMark = () => undefined;

  renderPage(<BulkCheckPage api={api} onNavigate={ignoreNavigation} onOpenMark={onOpenMark} />);
  fireEvent.change(screen.getByLabelText("Phrases to check"), {
    target: { value: "Turtle Club" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Bulk check" }));

  const refresh = await screen.findByRole("button", { name: "Refresh matches" });
  dataVersion = "8";
  fireEvent.click(refresh);

  expect(
    await screen.findByRole("link", {
      name: "TURTLE CLUB, Live, serial number 70000001",
    })
  ).toBeTruthy();
  expect(screenInputs).toHaveLength(2);
});

test("does not silently truncate a bulk check over 100 phrases", () => {
  const inputs: Parameters<BulkCheckApi["screen"]>[0][] = [];
  const api: BulkCheckApi = {
    screen: (input) => {
      inputs.push(input);
      return Promise.resolve({ meta: { dataVersion: "7" }, queries: [] });
    },
    search: () => Promise.reject(new Error("Search should not run")),
  };
  const onOpenMark = () => undefined;
  const phrases = Array.from({ length: 101 }, (_, index) => `Phrase ${index + 1}`).join("\n");

  renderPage(<BulkCheckPage api={api} onNavigate={ignoreNavigation} onOpenMark={onOpenMark} />);
  fireEvent.change(screen.getByLabelText("Phrases to check"), {
    target: { value: phrases },
  });

  expect(screen.getByText("Bulk check accepts up to 100 phrases.")).toBeTruthy();
  const action = screen.getByRole("button", { name: "Bulk check" }) as HTMLButtonElement;
  expect(action.disabled).toBe(false);
  fireEvent.click(action);
  expect(screen.getByRole("button", { name: "Trim to 100" })).toBeTruthy();
  expect(inputs).toEqual([]);
});

function renderPage(page: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{page}</QueryClientProvider>);
}
