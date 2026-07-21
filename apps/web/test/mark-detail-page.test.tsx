import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { afterEach, expect, mock, test } = await import("bun:test");
const { MarkDetailPage } = await import("../src/mark-detail-page.tsx");
type MarkApi = import("../src/mark-detail-page.tsx").MarkApi;

afterEach(cleanup);

const noop = () => undefined;
const additionalOwnerPattern = /Also recorded as KAHR ARMS/;
const kahrArmsPattern = /KAHR ARMS/;
const assignmentPattern = /ASSIGNMENT OF OWNERSHIP/;
const canonicalProjectionPattern = /Canonical projection/;
const designMarkPattern = /Design mark/;
const drawingCodePattern = /Drawing code/;
const materializationPattern = /materialization/;
const registeredLinePattern = /^Registered /;
const showAllPattern = /Show all/;
const trtyrapPattern = /TRTYRAP/;
const tsdrHref =
  "https://tsdr.uspto.gov/#caseNumber=60146682&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch";

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
      projection: "uspto-projection-v2" as const,
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
  type: "design" as const,
};

test("renders the mark as one actionable detail document", async () => {
  const api: MarkApi = { get: async () => mark };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  expect(await screen.findByRole("heading", { name: "MACHINE-PISTOL" })).toBeTruthy();
  expect(screen.getByText("0146682")).toBeTruthy();
  expect(screen.getByText("AUTO ORDNANCE CORPORATION")).toBeTruthy();
  expect(screen.getByText("pistols")).toBeTruthy();
  expect(screen.queryByText("MACHINE-PISTOL literal element")).toBeNull();
  expect(screen.getByText("Dead")).toBeTruthy();
  expect(screen.getByText("USPTO status 626")).toBeTruthy();
  expect(screen.getAllByText("AUTO ORDNANCE CORPORATION")).toHaveLength(1);
  expect(screen.getByText(kahrArmsPattern)).toBeTruthy();

  const officialRecord = screen.getByRole("link", { name: "Open official USPTO record" });
  expect(officialRecord.getAttribute("href")).toBe(tsdrHref);
  expect(officialRecord.getAttribute("target")).toBe("_blank");
  expect(officialRecord.getAttribute("rel")).toBe("noreferrer");

  const goods = screen.getByRole("region", { name: "Goods/services" });
  const record = screen.getByRole("region", { name: "Record" });
  expect(within(record).getByText("Mark type")).toBeTruthy();
  expect(within(record).getByText(designMarkPattern)).toBeTruthy();
  const pistolsRow = within(goods).getByText("pistols").closest("tr");
  expect(pistolsRow).toBeTruthy();
  expect(within(pistolsRow as HTMLElement).getByText("009")).toBeTruthy();
  expect(within(goods).queryByText(drawingCodePattern)).toBeNull();
  expect(within(record).queryByText("Drawing code")).toBeNull();
  expect(within(record).queryByText("Source transaction")).toBeNull();
  expect(within(record).getByText("Registered 1921-09-20")).toBeTruthy();
  expect(within(record).getByText(additionalOwnerPattern)).toBeTruthy();
  expect(within(record).getByRole("button", { name: "Copy serial number" })).toBeTruthy();
  expect(goods.compareDocumentPosition(record)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(document.querySelector('[data-status="dead"]')).toBeTruthy();

  const history = screen.getByRole("list", { name: "Status history" });
  expect(within(history).getAllByRole("listitem")[0]?.textContent).toContain("2005-10-11");
  expect(within(history).getByText("Registration cancelled")).toBeTruthy();
  expect(within(history).queryByText("Current")).toBeNull();
  expect(screen.getByText("Reported by the USPTO.")).toBeTruthy();

  expect(screen.queryByText("USPTO source and provenance")).toBeNull();
  expect(screen.queryByText(trtyrapPattern)).toBeNull();
  expect(screen.queryByText(canonicalProjectionPattern)).toBeNull();
  expect(screen.queryByText("2016-03-16")).toBeNull();
  expect(screen.getByText(mark.legalDisclaimer)).toBeTruthy();
});

test("shows five status events by default and discloses the full history", async () => {
  const statusEvents = Array.from({ length: 7 }, (_, index) => ({
    code: `E${index}`,
    date: `2026-0${7 - index}-15`,
    description:
      index % 2 === 0
        ? "ASSIGNMENT OF OWNERSHIP NOT UPDATED AUTOMATICALLY"
        : "TEAS CHANGE OF CORRESPONDENCE RECEIVED",
    number: `${index + 1}`,
    type: "O",
  }));
  const api: MarkApi = { get: async () => ({ ...mark, statusEvents }) };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  const history = await screen.findByRole("list", { name: "Status history" });
  expect(within(history).getAllByRole("listitem")).toHaveLength(5);
  expect(
    within(history).getAllByText("Assignment of ownership not updated automatically").length
  ).toBeGreaterThan(0);
  expect(within(history).queryByText(assignmentPattern)).toBeNull();

  const disclosure = screen.getByRole("button", { name: "Show all 7 events" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(disclosure.getAttribute("aria-controls")).toBe("status-history-list");

  fireEvent.click(disclosure);

  expect(within(history).getAllByRole("listitem")).toHaveLength(7);
  const collapse = screen.getByRole("button", { name: "Show fewer events" });
  expect(collapse.getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(collapse);
  expect(within(history).getAllByRole("listitem")).toHaveLength(5);
});

test("keeps every class code with its goods or services description", async () => {
  const classStatements = [
    { code: "003", description: "cosmetics" },
    { code: "009", description: "downloadable software" },
    { code: "016", description: "printed matter" },
    { code: "018", description: "bags and luggage" },
    { code: "025", description: "clothing" },
    { code: "028", description: "sporting goods" },
    { code: "035", description: "retail store services" },
    { code: "041", description: "education services" },
    { code: "042", description: "software services" },
    { code: "045", description: "legal services" },
  ] as const;
  const manyClasses: MarkApi = {
    get: async () => ({
      ...mark,
      classes: classStatements.map(({ code }) => ({
        internationalCode: code,
        statusCode: "6",
        statusDate: "2010-04-08",
      })),
      goodsServices: classStatements.map(({ code, description }) => ({
        text: description,
        typeCode: `GS${code}1`,
      })),
    }),
  };
  render(<MarkDetailPage api={manyClasses} onBack={noop} serialNumber="60146682" />);

  const goods = await screen.findByRole("region", { name: "Goods/services" });
  const table = within(goods).getByRole("table", { name: "Goods and services by class" });
  expect(within(table).getAllByRole("row")).toHaveLength(11);
  for (const { code, description } of classStatements) {
    const row = within(goods).getByText(description).closest("tr");
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText(code)).toBeTruthy();
  }
});

test("renders registration facts only when the mark is registered", async () => {
  const api: MarkApi = {
    get: async () => ({
      ...mark,
      mark: { ...mark.mark, registrationDate: null, registrationNumber: null },
    }),
  };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  const record = await screen.findByRole("region", { name: "Record" });
  expect(within(record).getByText("Not registered")).toBeTruthy();
  expect(within(record).queryByText(registeredLinePattern)).toBeNull();
});

test("shows an empty status history without internal jargon", async () => {
  const api: MarkApi = { get: async () => ({ ...mark, statusEvents: [] }) };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  expect(await screen.findByText("No status events reported.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: showAllPattern })).toBeNull();
  expect(screen.queryByText(materializationPattern)).toBeNull();
});

test("copies the serial number with visible confirmation", async () => {
  const writeText = mock(async (_text: string) => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const api: MarkApi = { get: async () => mark };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  fireEvent.click(await screen.findByRole("button", { name: "Copy serial number" }));

  expect(writeText).toHaveBeenCalledWith("60146682");
  expect(await screen.findByText("Serial number copied")).toBeTruthy();
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
      classes: ["009", "025", "028"].map((internationalCode) => ({
        internationalCode,
        statusCode: "6",
        statusDate: "2010-04-08",
      })),
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
  expect(within(shirts.closest("tr") as HTMLElement).getByText("025")).toBeTruthy();
  expect(within(golfBalls.closest("tr") as HTMLElement).getByText("028")).toBeTruthy();
  expect(shirts.compareDocumentPosition(golfBalls)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(within(goods).queryByText("literal element statement")).toBeNull();
});

test("does not present a source statement code as an authoritative international class", async () => {
  const api: MarkApi = {
    get: async () => ({
      ...mark,
      classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2010-04-08" }],
      goodsServices: [{ text: "alteration and tailoring", typeCode: "GS0371" }],
    }),
  };

  render(<MarkDetailPage api={api} onBack={noop} serialNumber="60146682" />);

  const goods = await screen.findByRole("region", { name: "Goods/services" });
  const statementRow = within(goods).getByText("alteration and tailoring").closest("tr");
  expect(statementRow).toBeTruthy();
  expect(within(statementRow as HTMLElement).queryByText("037")).toBeNull();
  expect(within(goods).getByText("International classes")).toBeTruthy();
  expect(within(goods).getByText("025")).toBeTruthy();
});
