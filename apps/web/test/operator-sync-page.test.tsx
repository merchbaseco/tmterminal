import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
Element.prototype.getAnimations ??= () => [];

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { OperatorSyncPage } = await import("../src/operator-sync-page.tsx");
type OperatorSyncApi = import("../src/operator-sync-page.tsx").OperatorSyncApi;

afterEach(cleanup);

const summary = {
  activeState: "failed" as const,
  completeThroughDate: "2026-07-14",
  corpusVersion: 9,
  degraded: true,
  degradedSince: "2026-07-15T12:00:00.000Z",
  failedCount: 1,
  lastSuccessfulMergeAt: "2026-07-15T11:00:00.000Z",
  pendingCount: 1,
  publishedThroughDate: "2026-07-15",
  quarantineCount: 1,
  rejectCount: 1,
  reissueSelectionRequiredCount: 0,
  stale: false,
  staleSince: null,
};

function dataset(product: "TRTDXFAP" | "TRTYRAP", failed = false) {
  return {
    backlogCount: failed ? 1 : 0,
    completeThroughDate: product === "TRTDXFAP" ? "2026-07-14" : "2025-12-31",
    coverageFromDate: product === "TRTDXFAP" ? "2026-07-14" : "1884-04-07",
    coverageThroughDate: product === "TRTDXFAP" ? "2026-07-15" : "2025-12-31",
    currentStage: failed ? "failed" as const : "idle" as const,
    failedCount: failed ? 1 : 0,
    latestPublicationAt: "2026-07-15T11:00:00.000Z",
    latestSuccessfulActivityAt: "2026-07-15T10:00:00.000Z",
    product,
    providerBackoffUntil: null,
    providerStopReason: null,
    quarantineCount: failed ? 1 : 0,
    reason: failed ? "Retained artifact bytes are missing" : null,
    rejectCount: failed ? 1 : 0,
    stageSince: failed ? "2026-07-15T12:00:00.000Z" : null,
  };
}

function api(overrides: Partial<OperatorSyncApi> = {}): OperatorSyncApi {
  return {
    artifacts: async ({ limit, offset }) => ({
      items: offset === 0 ? [{
        artifactId: "artifact-1",
        artifactVersionId: "version-1",
        bytes: 100,
        filename: "apc260715.zip",
        lastErrorAt: null,
        lastErrorCode: null,
        observedAt: "2026-07-15T10:00:00.000Z",
        parseRunId: "parse-1",
        product: "TRTDXFAP" as const,
        quarantineReason: "Malformed record framing",
        retainedVersionCount: 1,
        selectedArtifactVersionId: null,
        selectedSha256: null,
        selectionRequired: false,
        sha256: "a".repeat(64),
        sourceFromDate: "2026-07-15",
        sourceToDate: "2026-07-15",
        stage: "quarantined" as const,
        stageSince: "2026-07-15T12:00:00.000Z",
      }] : [],
      limit,
      offset,
      total: 26,
    }),
    artifactVersions: async ({ limit, offset }) => ({
      items: offset === 0 ? [{
        artifactId: "artifact-1",
        artifactVersionId: "version-alternate",
        bytes: 100,
        createdAt: "2026-07-15T09:00:00.000Z",
        filename: "apc260715.zip",
        observedAt: "2026-07-15T09:00:00.000Z",
        parseState: "staged" as const,
        parserVersion: "uspto-application-xml-v2",
        product: "TRTDXFAP" as const,
        quarantineReason: null,
        selected: true,
        sha256: "b".repeat(64),
        sourceFromDate: "2026-07-15",
        sourceToDate: "2026-07-15",
        state: "staged" as const,
      }] : [],
      limit,
      offset,
      total: 1,
    }),
    publications: async ({ limit, offset }) => ({ items: [], limit, offset, total: 0 }),
    rejects: async ({ limit, offset }) => ({ items: [], limit, offset, total: 0 }),
    status: async () => ({ datasets: [dataset("TRTYRAP"), dataset("TRTDXFAP", true)], summary }),
    ...overrides,
  } as OperatorSyncApi;
}

test("renders the operator happy path and identifies one failed dataset and quarantined artifact", async () => {
  render(<OperatorSyncPage api={api()} />);

  expect(await screen.findByRole("heading", { name: "TRTDXFAP" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "TRTYRAP" })).toBeTruthy();
  expect(screen.getByText("Retained artifact bytes are missing")).toBeTruthy();
  expect(screen.getByText("Malformed record framing")).toBeTruthy();
  expect(screen.getAllByText("apc260715.zip")).toHaveLength(2);
  expect(screen.getByText("version-alternate")).toBeTruthy();
  expect(screen.getByText("selected · staged")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /retry|rebuild|quarantine|reissue/i })).toBeNull();
});

test("date-only coverage stays on January 1 outside UTC", async () => {
  const daily = {
    ...dataset("TRTDXFAP"),
    completeThroughDate: "2026-01-01",
    coverageFromDate: "2026-01-01",
    coverageThroughDate: "2026-01-01",
  };
  render(<OperatorSyncPage api={api({
    status: async () => ({ datasets: [dataset("TRTYRAP"), daily], summary }),
  })} />);

  const dailyCard = (await screen.findByRole("heading", { name: "TRTDXFAP" })).closest("article")!;
  expect(within(dailyCard).getByText("Jan 1, 2026 — Jan 1, 2026")).toBeTruthy();
  expect(within(dailyCard).getByText("Jan 1, 2026")).toBeTruthy();
  expect(within(dailyCard).queryByText("Dec 31, 2025")).toBeNull();
});

test("active work keeps the provider stop reason independently visible", async () => {
  const daily = {
    ...dataset("TRTDXFAP"),
    currentStage: "parsing" as const,
    providerStopReason: "USPTO credential rejected",
    stageSince: "2026-07-15T12:00:00.000Z",
  };
  render(<OperatorSyncPage api={api({
    status: async () => ({ datasets: [dataset("TRTYRAP"), daily], summary }),
  })} />);

  await screen.findByRole("heading", { name: "TRTDXFAP" });
  expect(screen.getByText("parsing")).toBeTruthy();
  expect(screen.getByText("USPTO credential rejected")).toBeTruthy();
});

test("renders the server-enforced non-operator path", async () => {
  const forbidden = Object.assign(new Error("Operator access required"), { data: { code: "FORBIDDEN" } });
  render(<OperatorSyncPage api={api({ status: async () => { throw forbidden; } })} />);

  expect((await screen.findByRole("alert")).textContent).toBe("This page requires the server-side operator role.");
  expect(screen.queryByText("Recent artifacts")).toBeNull();
});

test("a failed bounded page read is surfaced while the previous page remains explicit", async () => {
  const operatorApi = api({
    artifacts: async (input) => {
      if (input.offset > 0) throw new Error("page unavailable");
      return api().artifacts(input);
    },
  });
  render(<OperatorSyncPage api={operatorApi} />);
  await screen.findAllByText("apc260715.zip");
  const next = screen.getAllByRole("button", { name: "Next" }).find((button) => !(button as HTMLButtonElement).disabled);
  expect(next).toBeTruthy();
  fireEvent.click(next!);

  expect((await screen.findByRole("alert")).textContent).toBe("Artifact page could not be loaded; the previous page remains shown.");
  expect(screen.getByText("1–25 of 26")).toBeTruthy();
});

test("artifact pagination excludes overlapping requests while the next page is pending", async () => {
  let resolvePage!: (page: Awaited<ReturnType<OperatorSyncApi["artifacts"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<OperatorSyncApi["artifacts"]>>>((resolve) => {
    resolvePage = resolve;
  });
  let pageCalls = 0;
  const operatorApi = api({
    artifacts: async (input) => {
      if (input.offset === 0) return api().artifacts(input);
      pageCalls += 1;
      return pending;
    },
  });
  render(<OperatorSyncPage api={operatorApi} />);
  await screen.findAllByText("apc260715.zip");
  const next = screen.getAllByRole("button", { name: "Next" }).find((button) => !(button as HTMLButtonElement).disabled)!;
  fireEvent.click(next);
  fireEvent.click(next);

  expect(pageCalls).toBe(1);
  expect((next as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    resolvePage({ items: [], limit: 25, offset: 25, total: 26 });
    await pending;
  });
});
