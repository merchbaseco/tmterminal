import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import {
  type AnnualMarkProjection,
  streamAnnualProjections,
} from "../../src/ingestion/annual-projection.ts";

const coordinate = { filename: "annual.zip", product: "TRTYRAP" as const, sha256: "a".repeat(64) };
const validVersion =
  "<version><version-no>2.0</version-no><version-date>20041108</version-date></version>";
function documentBody(
  records: string,
  version = validVersion,
  root = "trademark-applications-daily"
) {
  return `<${root}>${version}<application-information><file-segments><file-segment>1</file-segment><action-keys><action-key>TX</action-key>${records}</action-keys></file-segments></application-information></${root}>`;
}
function document(records: string, version = validVersion, root = "trademark-applications-daily") {
  return Readable.from([
    `<?xml version="1.0" encoding="UTF-8"?>${documentBody(records, version, root)}`,
  ]);
}

test("streams an authentic annual Class 025 record into a direct projection", async () => {
  const record = await readFile(
    "fixtures/uspto/records/annual-2025-large-class025-tx-74668071.xml",
    "utf8"
  );
  const projections: AnnualMarkProjection[] = [];
  const result = await streamAnnualProjections({
    coordinate,
    onBatch: (batch) => {
      projections.push(...batch);
      return Promise.resolve();
    },
    xml: document(record),
  });
  expect(result).toEqual({ physicalRecordCount: 1, projectedMarkCount: 1 });
  expect(projections[0]).toMatchObject({
    classes: [{ internationalCode: "025", statusCode: "6", statusDate: "1995-07-06" }],
    coordinate: { physicalRecordIndex: 1 },
    filingDate: "1995-05-01",
    registrationNumber: "1974886",
    serialNumber: "74668071",
    statusCode: "800",
    wordMark: "GUESS JEANS",
  });
  expect(projections[0]?.goodsServices[0]?.text).toContain("apparel");
  expect(projections[0]?.owners[0]?.partyName).toBe("GUESS? IP HOLDER L.P.");
});

test("normalizes an authentic malformed optional class date without dropping Class 025", async () => {
  const record = await readFile(
    "fixtures/uspto/records/annual-2025-malformed-class-date-tx-74800000.xml",
    "utf8"
  );
  const projections: AnnualMarkProjection[] = [];
  const result = await streamAnnualProjections({
    coordinate,
    onBatch: (batch) => {
      projections.push(...batch);
      return Promise.resolve();
    },
    xml: document(record),
  });
  expect(result).toEqual({ physicalRecordCount: 1, projectedMarkCount: 1 });
  expect(projections[0]).toMatchObject({
    classes: [{ internationalCode: "025", statusCode: "6", statusDate: null }],
    serialNumber: "74800000",
    wordMark: "GRIGIOPERLA",
  });
});

test("projects every authentic repeated international code for one classification", async () => {
  const record = await readFile(
    "fixtures/uspto/records/annual-2025-repeated-international-codes-tx-71060608.xml",
    "utf8"
  );
  const projections: AnnualMarkProjection[] = [];
  const result = await streamAnnualProjections({
    coordinate,
    onBatch: (batch) => {
      projections.push(...batch);
      return Promise.resolve();
    },
    xml: document(record),
  });
  expect(result).toEqual({ physicalRecordCount: 1, projectedMarkCount: 1 });
  expect(projections[0]).toMatchObject({
    classes: [
      { internationalCode: "006", statusCode: "6", statusDate: "1983-03-01" },
      { internationalCode: "020", statusCode: "6", statusDate: "1983-03-01" },
    ],
    serialNumber: "71060608",
    wordMark: "SARGENT",
  });
});

test("deduplicates identical status events while preserving distinct transitions", async () => {
  const event =
    "<case-file-event-statement><code>DOCK</code><type>D</type><description-text>ASSIGNED TO EXAMINER</description-text><date>20250101</date><number>1</number></case-file-event-statement>";
  const distinctEvent =
    "<case-file-event-statement><code>CNRT</code><type>F</type><description-text>NON-FINAL ACTION MAILED</description-text><date>20250102</date><number>2</number></case-file-event-statement>";
  const record = `<case-file><serial-number>12345678</serial-number><transaction-date>20250103</transaction-date><case-file-header><mark-identification>SHIRT</mark-identification><status-code>700</status-code></case-file-header><case-file-event-statements>${event}${event}${distinctEvent}</case-file-event-statements><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>`;
  const projections: AnnualMarkProjection[] = [];
  await streamAnnualProjections({
    coordinate,
    onBatch: (batch) => {
      projections.push(...batch);
      return Promise.resolve();
    },
    xml: document(record),
  });

  expect(projections[0]?.statusEvents.map(({ code }) => code)).toEqual(["DOCK", "CNRT"]);
});

test("validates the authentic annual part 49 maximum record without selecting it", async () => {
  const record = await readFile(
    "fixtures/uspto/records/annual-2025-largest-record-tx-85951867.xml",
    "utf8"
  );
  const projections: AnnualMarkProjection[] = [];
  const result = await streamAnnualProjections({
    coordinate,
    onBatch: (batch) => {
      projections.push(...batch);
      return Promise.resolve();
    },
    xml: document(record),
  });
  expect(result).toEqual({ physicalRecordCount: 1, projectedMarkCount: 0 });
  expect(projections).toEqual([]);
});

test("rejects a malformed physical record before selection", async () => {
  const record =
    "<case-file><transaction-date>20250101</transaction-date><case-file-header><mark-identification>SHIRT</mark-identification></case-file-header><classifications><primary-code>025</primary-code></classifications></case-file>";
  await expect(
    streamAnnualProjections({ coordinate, onBatch: async () => undefined, xml: document(record) })
  ).rejects.toThrow("serial-number");
});

test("rejects the wrong annual document root", async () => {
  const preamble = await readFile("fixtures/uspto/prologs/application-v2-current.xml", "utf8");
  expect(Buffer.byteLength(preamble)).toBe(14_700);
  const record =
    "<case-file><serial-number>12345678</serial-number><case-file-header><mark-identification>SHIRT</mark-identification><status-code>700</status-code></case-file-header><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>";
  await expect(
    streamAnnualProjections({
      coordinate,
      onBatch: async () => undefined,
      xml: Readable.from([preamble, documentBody(record, validVersion, "unexpected-root")]),
    })
  ).rejects.toThrow("trademark-applications-daily");
});

test("accepts the authentic annual declaration and internal DTD before the root", async () => {
  const preamble = await readFile("fixtures/uspto/prologs/application-v2-current.xml", "utf8");
  expect(Buffer.byteLength(preamble)).toBe(14_700);
  await expect(
    streamAnnualProjections({
      coordinate,
      onBatch: async () => undefined,
      xml: Readable.from([preamble, documentBody("")]),
    })
  ).resolves.toEqual({ physicalRecordCount: 0, projectedMarkCount: 0 });
});

test("rejects missing, duplicate, and unsupported annual versions", async () => {
  await expect(
    streamAnnualProjections({ coordinate, onBatch: async () => undefined, xml: document("", "") })
  ).rejects.toThrow("version-no must occur exactly once");
  await expect(
    streamAnnualProjections({
      coordinate,
      onBatch: async () => undefined,
      xml: document("", `${validVersion}${validVersion}`),
    })
  ).rejects.toThrow("version-no must occur exactly once");
  await expect(
    streamAnnualProjections({
      coordinate,
      onBatch: async () => undefined,
      xml: document(
        "",
        "<version><version-no>1.0</version-no><version-date>20041108</version-date></version>"
      ),
    })
  ).rejects.toThrow("Unsupported USPTO XML version");
});

test("rejects missing, duplicate, and unsupported annual version dates", async () => {
  await expect(
    streamAnnualProjections({
      coordinate,
      onBatch: async () => undefined,
      xml: document("", "<version><version-no>2.0</version-no></version>"),
    })
  ).rejects.toThrow("version-date must occur exactly once");
  await expect(
    streamAnnualProjections({
      coordinate,
      onBatch: async () => undefined,
      xml: document(
        "",
        "<version><version-no>2.0</version-no><version-date>20041108</version-date><version-date>20041108</version-date></version>"
      ),
    })
  ).rejects.toThrow("version-date must occur exactly once");
  await expect(
    streamAnnualProjections({
      coordinate,
      onBatch: async () => undefined,
      xml: document(
        "",
        "<version><version-no>2.0</version-no><version-date>20251231</version-date></version>"
      ),
    })
  ).rejects.toThrow("Unsupported USPTO XML version date");
});

test("rejects an eight-digit optional date that is not a calendar date", async () => {
  const record =
    "<case-file><serial-number>12345678</serial-number><transaction-date>20250230</transaction-date><case-file-header><mark-identification>SHIRT</mark-identification><status-code>700</status-code></case-file-header><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>";
  await expect(
    streamAnnualProjections({ coordinate, onBatch: async () => undefined, xml: document(record) })
  ).rejects.toThrow("transaction-date is not a calendar date");
});

test("flushes direct projections in fixed batches", async () => {
  const record = (index: number) =>
    `<case-file><serial-number>${String(index).padStart(8, "0")}</serial-number><transaction-date>20250101</transaction-date><case-file-header><mark-identification>SHIRT ${index}</mark-identification><status-code>700</status-code><status-date>20250101</status-date></case-file-header><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>`;
  const sizes: number[] = [];
  const result = await streamAnnualProjections({
    coordinate,
    onBatch: (batch) => {
      sizes.push(batch.length);
      return Promise.resolve();
    },
    xml: document(Array.from({ length: 101 }, (_, index) => record(index + 1)).join("")),
  });
  expect(result).toEqual({ physicalRecordCount: 101, projectedMarkCount: 101 });
  expect(sizes).toEqual([100, 1]);
});
