import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const { cleanup, render, screen } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { MarkDetailPage } = await import("../src/mark-detail-page.tsx");
type MarkApi = import("../src/mark-detail-page.tsx").MarkApi;

afterEach(cleanup);

const mark = {
  classes: [{ internationalCode: "009", statusCode: "6", statusDate: "2010-04-08" }],
  goodsServices: [{ text: "pistols", typeCode: "GS0091" }],
  legalDisclaimer: "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel." as const,
  mark: {
    filingDate: "1920-09-25",
    markDrawingCode: "3",
    registrationDate: "1921-09-20",
    registrationNumber: "0146682",
    serialNumber: "60146682",
    sourceTransactionDate: "2016-03-16",
    statusCode: "626",
    statusDate: "2005-10-11",
    wordMark: "MACHINE-PISTOL",
  },
  owners: [{ entryNumber: "1", partyName: "AUTO ORDNANCE CORPORATION", partyType: "10" }],
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

test("renders the retained mark as one provenance-rich detail document", async () => {
  const api: MarkApi = { get: async () => mark };

  render(<MarkDetailPage api={api} serialNumber="60146682" />);

  expect(await screen.findByRole("heading", { name: "MACHINE-PISTOL" })).toBeTruthy();
  expect(screen.getByText("0146682")).toBeTruthy();
  expect(screen.getByText("AUTO ORDNANCE CORPORATION")).toBeTruthy();
  expect(screen.getByText("pistols")).toBeTruthy();
  expect(screen.getByText("2016-03-16")).toBeTruthy();
  expect(screen.getByText(/TRTYRAP · record 1/)).toBeTruthy();
  expect(screen.getByText("case-file/case-file-header/mark-identification")).toBeTruthy();
  expect(screen.getByText(mark.legalDisclaimer)).toBeTruthy();
});

test("renders the exact not-found document without stale mark data", async () => {
  const notFound = Object.assign(new Error("Trademark not found"), { data: { code: "NOT_FOUND" } });
  const api: MarkApi = { get: async () => { throw notFound; } };

  render(<MarkDetailPage api={api} serialNumber="99999999" />);

  expect((await screen.findByRole("alert")).textContent).toBe("Trademark not found");
  expect(screen.queryByText("MACHINE-PISTOL")).toBeNull();
});
