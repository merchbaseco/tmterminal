import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { ReportsPage } = await import("../src/reports-page.tsx");
type ReportsApi = import("../src/reports-page.tsx").ReportsApi;
const weeklyTurtleLinkPattern = /WEEKLY TURTLE/;

afterEach(cleanup);

const result = {
  from: "2026-07-06",
  items: [
    {
      goodsServicesExcerpt: "shirts",
      internationalClasses: ["025"],
      owner: "TURTLE GOODS LLC",
      registrationNumber: null,
      serialNumber: "70000001",
      sourceTransactionDate: "2026-07-10",
      status: "live" as const,
      statusDate: "2026-07-10",
      type: "text" as const,
      wordMark: "WEEKLY TURTLE",
    },
  ],
  limit: 25 as const,
  meta: { dataVersion: "7" },
  offset: 0,
  to: "2026-07-12",
  total: 1,
};
const noop = () => undefined;
const legalDisclaimerPattern = /Trademark data is informational/;

function renderReports(api: ReportsApi, search: string, onNavigate: (href: string) => void = noop) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (currentSearch: string) => (
    <QueryClientProvider client={queryClient}>
      <ReportsPage
        api={api}
        onNavigate={onNavigate}
        onOpenMark={noop}
        restoreScrollOffset={0}
        search={currentSearch}
      />
    </QueryClientProvider>
  );
  const view = render(page(search));
  return {
    ...view,
    queryClient,
    rerenderReports: (currentSearch: string) => view.rerender(page(currentSearch)),
  };
}

test("filed preset renders its resolved week and reuses customer mark rows", async () => {
  const inputs: Parameters<ReportsApi["run"]>[0][] = [];
  renderReports(
    {
      run: (input) => {
        inputs.push(input);
        return Promise.resolve(result);
      },
    },
    "?event=filed&window=previous-week"
  );

  expect(await screen.findByRole("heading", { name: "FILED" })).toBeTruthy();
  expect(screen.getByText("Jul 6–12, 2026")).toBeTruthy();
  expect(screen.getByRole("link", { name: weeklyTurtleLinkPattern })).toBeTruthy();
  expect(screen.getByText("Filed previous week")).toBeTruthy();
  expect(screen.getByText(legalDisclaimerPattern)).toBeTruthy();
  expect(inputs[0]).toMatchObject({ event: "filed", offset: 0, window: "previous-week" });
});

test("pins the resolved week and recovers from a continuation conflict", async () => {
  const inputs: Parameters<ReportsApi["run"]>[0][] = [];
  const navigations: string[] = [];
  const view = renderReports(
    {
      run: (input) => {
        inputs.push(input);
        if ((input.offset ?? 0) > 0) {
          return Promise.reject(
            Object.assign(new Error("conflict"), { data: { code: "CONFLICT" } })
          );
        }
        return Promise.resolve({ ...result, total: 26 });
      },
    },
    "?event=filed&window=previous-week",
    (href) => navigations.push(href)
  );

  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await waitFor(() => expect(navigations).toHaveLength(1));
  const continuation = new URL(navigations[0] ?? "", "https://example.test");
  view.rerenderReports(continuation.search);
  expect(
    await screen.findByText("Trademark data changed. Run the report again before continuing.")
  ).toBeTruthy();
  expect(inputs[1]).toMatchObject({
    expectedDataVersion: "7",
    expectedFrom: "2026-07-06",
    expectedTo: "2026-07-12",
    offset: 25,
  });

  fireEvent.click(screen.getByRole("button", { name: "Run report again" }));
  await waitFor(() => expect(navigations).toHaveLength(2));
  view.rerenderReports(new URL(navigations[1] ?? "", "https://example.test").search);
  await waitFor(() => expect(inputs.at(-1)?.offset ?? 0).toBe(0));
  expect(await screen.findByRole("link", { name: weeklyTurtleLinkPattern })).toBeTruthy();
});

test("keeps report type and page identity in the generated URL", async () => {
  const inputs: Parameters<ReportsApi["run"]>[0][] = [];
  const navigations: string[] = [];
  const view = renderReports(
    {
      run: (input) => {
        inputs.push(input);
        return Promise.resolve({ ...result, offset: input.offset ?? 0, total: 26 });
      },
    },
    "?event=filed&window=previous-week&type=other",
    (href) => navigations.push(href)
  );

  expect(await screen.findByRole("button", { name: "Type: Other" })).toBeTruthy();
  expect(inputs[0]?.type).toBe("other");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(navigations).toHaveLength(1));
  const next = new URL(navigations[0] ?? "", "https://example.test");
  expect(next.searchParams.get("offset")).toBe("25");
  expect(next.searchParams.get("dataVersion")).toBe("7");
  expect(next.searchParams.get("from")).toBe("2026-07-06");
  expect(next.searchParams.get("to")).toBe("2026-07-12");

  view.rerenderReports(next.search);
  expect(await screen.findByText("26–26 of 26")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(navigations).toHaveLength(2));
  const previous = new URL(navigations[1] ?? "", "https://example.test");
  expect(previous.searchParams.get("offset")).toBe("0");
  expect(previous.searchParams.get("dataVersion")).toBe("7");
  expect(previous.searchParams.get("from")).toBe("2026-07-06");
  expect(previous.searchParams.get("to")).toBe("2026-07-12");
});

test("report filters generate a URL without changing the preset constraint", async () => {
  const navigations: string[] = [];
  renderReports(
    { run: () => Promise.resolve(result) },
    "?event=registered&window=previous-week",
    (href) => navigations.push(href)
  );
  await screen.findByRole("heading", { name: "REGISTERED" });

  fireEvent.click(screen.getByRole("button", { name: "Status: All" }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Live" }));

  await waitFor(() => expect(navigations).toHaveLength(1));
  const url = new URL(navigations[0] ?? "", "https://example.test");
  expect(url.pathname).toBe("/reports");
  expect(url.searchParams.get("event")).toBe("registered");
  expect(url.searchParams.get("window")).toBe("previous-week");
  expect(url.searchParams.get("status")).toBe("live");
});

test("explains that reports are temporarily unavailable", async () => {
  renderReports(
    {
      run: () =>
        Promise.reject(
          Object.assign(new Error("unavailable"), { data: { code: "SERVICE_UNAVAILABLE" } })
        ),
    },
    "?event=filed&window=previous-week"
  );

  expect(
    await screen.findByText("Reports are temporarily unavailable. Try again shortly.")
  ).toBeTruthy();
  expect(screen.getByText(legalDisclaimerPattern)).toBeTruthy();
});

test("keeps the legal disclaimer in empty and loading report states", async () => {
  const pending = new Promise<typeof result>(() => undefined);
  const view = renderReports({ run: () => pending }, "?event=filed&window=previous-week");
  expect(screen.getByText(legalDisclaimerPattern)).toBeTruthy();

  view.unmount();
  renderReports(
    {
      run: () =>
        Promise.resolve({
          ...result,
          items: [],
          meta: result.meta,
          total: 0,
        }),
    },
    "?event=filed&window=previous-week"
  );
  expect(await screen.findByText("No marks in this report.")).toBeTruthy();
  expect(screen.getByText(legalDisclaimerPattern)).toBeTruthy();
});

test("does not gate an empty report on source-file coverage", async () => {
  renderReports(
    { run: () => Promise.resolve({ ...result, items: [], total: 0 }) },
    "?event=filed&window=previous-week"
  );

  expect(await screen.findByText("No marks in this report.")).toBeTruthy();
  expect(screen.queryByText("Corpus freshness")).toBeNull();
});

test("hides cached report data after a failed refresh", async () => {
  let calls = 0;
  const view = renderReports(
    {
      run: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve(result) : Promise.reject(new Error("refresh failed"));
      },
    },
    "?event=filed&window=previous-week"
  );
  expect(await screen.findByRole("link", { name: weeklyTurtleLinkPattern })).toBeTruthy();

  await view.queryClient.invalidateQueries({ queryKey: ["reports.run"] });

  expect((await screen.findByRole("alert")).textContent).toBe("Report could not be loaded.");
  expect(screen.queryByRole("link", { name: "WEEKLY TURTLE" })).toBeNull();
  expect(screen.queryByText("Jul 6–12, 2026")).toBeNull();
});
