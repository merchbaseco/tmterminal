import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

const { cleanup, render, screen, within } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { MarkDetailPage } = await import("../src/mark-detail-page.tsx");
type MarkApi = import("../src/mark-detail-page.tsx").MarkApi;

afterEach(cleanup);

const noop = () => undefined;
const provenanceRecordPattern = /TRTYRAP · record 1/;
const additionalOwnerPattern = /Also recorded as KAHR ARMS/;
const kahrArmsPattern = /KAHR ARMS/;

const mark = {
  classes: [{ internationalCode: "009", statusCode: "6", statusDate: "2010-04-08" }],
  goodsServices: [
    { text: "pistols", typeCode: "GS0091" },
    { text: "MACHINE-PISTOL literal element", typeCode: "DM0000" },
  ],
  legalDisclaimer:
    "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel." as const,
  mark: {
    filingDate: "1920-09-25",
    markDrawingCode: "3",
    registrationDate: "1921-09-20",
    registrationNumber: "0146682",
    serialNumber: "60146682",
    sourceTransactionDate: "2016-03-16",
    status: "dead" as const,
    statusCode: "626",
    statusDate: "2005-10-11",
    wordMark: "MACHINE-PISTOL",
  },
  owners: [
    { entryNumber: "1", partyName: "AUTO ORDNANCE CORPORATION", partyType: "10" },
    { entryNumber: "2", partyName: "Auto-Ordnance Corporation", partyType: "10" },
    { entryNumber: "3", partyName: "KAHR ARMS", partyType: "10" },
  ],
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
      projection: "uspto-projection-v1" as const,
      sourceProfile: "uspto-application-xml-v2.0-v1" as const,
    },
  },
  statusEvents: [
    {
      code: "C8",
      date: "2005-10-11",
      description: "Registration cancelled",
      number: "2",
      type: "O",
    },
    { code: "A1", date: "1920-10-01", description: "Application received", number: "1", type: "O" },
  ],
};

test("renders the retained mark as one provenance-rich detail document", async () => {
  const api: MarkApi = { get: async () => mark };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  expect(await screen.findByRole("heading", { name: "MACHINE-PISTOL" })).toBeTruthy();
  expect(screen.getByText("0146682")).toBeTruthy();
  expect(screen.getByText("AUTO ORDNANCE CORPORATION")).toBeTruthy();
  expect(screen.getByText("pistols")).toBeTruthy();
  expect(screen.queryByText("MACHINE-PISTOL literal element")).toBeNull();
  expect(screen.getByText("2016-03-16")).toBeTruthy();
  expect(screen.getByText("Dead")).toBeTruthy();
  expect(screen.getByText("USPTO status 626")).toBeTruthy();
  expect(screen.getAllByText("AUTO ORDNANCE CORPORATION")).toHaveLength(1);
  expect(screen.getByText(kahrArmsPattern)).toBeTruthy();
  const goods = screen.getByRole("region", { name: "Goods/services" });
  const record = screen.getByRole("region", { name: "Record" });
  expect(within(record).getByText("Drawing code")).toBeTruthy();
  expect(within(record).getByText(additionalOwnerPattern)).toBeTruthy();
  expect(goods.compareDocumentPosition(record)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(document.querySelector('[data-status="dead"]')).toBeTruthy();
  const history = screen.getByRole("list", { name: "Status history as reported by USPTO" });
  expect(within(history).getAllByRole("listitem")[0]?.textContent).toContain("2005-10-11");
  expect(within(history).queryByText("Current")).toBeNull();
  expect(screen.getByText(provenanceRecordPattern)).toBeTruthy();
  expect(screen.getByText("case-file/case-file-header/mark-identification")).toBeTruthy();
  expect(screen.getByText(mark.legalDisclaimer)).toBeTruthy();
});

test("renders the exact not-found document without stale mark data", async () => {
  const notFound = Object.assign(new Error("Trademark not found"), { data: { code: "NOT_FOUND" } });
  const api: MarkApi = {
    get: () => Promise.reject(notFound),
  };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="99999999" />);

  expect((await screen.findByRole("alert")).textContent).toBe("Trademark not found");
  expect(screen.queryByText("MACHINE-PISTOL")).toBeNull();
});

test("shows goods statements only and puts Class 025 first", async () => {
  const api: MarkApi = {
    get: async () => ({
      ...mark,
      goodsServices: [
        { text: "golf balls", typeCode: "GS0281" },
        { text: "literal element statement", typeCode: "DM0000" },
        { text: "shirts and jackets", typeCode: "GS0251" },
      ],
    }),
  };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  const goods = await screen.findByRole("region", { name: "Goods/services" });
  const shirts = within(goods).getByText("shirts and jackets");
  const golfBalls = within(goods).getByText("golf balls");
  expect(shirts.compareDocumentPosition(golfBalls)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(within(goods).queryByText("literal element statement")).toBeNull();
});
