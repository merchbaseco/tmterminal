import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import {
  type MarkUpsertProjection,
  streamTrademarkProjections,
  type TrademarkProjection,
} from "../../src/ingestion/trademark-projection.ts";

const coordinate = {
  contentRevision: 1,
  filename: "annual.zip",
  parserVersion: "uspto-projection-v2",
  product: "TRTYRAP" as const,
  sha256: "a".repeat(64),
};
const validVersion =
  "<version><version-no>2.0</version-no><version-date>20041108</version-date></version>";
function documentBody(
  records: string,
  version = validVersion,
  root = "trademark-applications-daily",
  actionKey = "TX"
) {
  return `<${root}>${version}<application-information><file-segments><file-segment>1</file-segment><action-keys><action-key>${actionKey}</action-key>${records}</action-keys></file-segments></application-information></${root}>`;
}
function document(
  records: string,
  version = validVersion,
  root = "trademark-applications-daily",
  actionKey = "TX"
) {
  return Readable.from([
    `<?xml version="1.0" encoding="UTF-8"?>${documentBody(records, version, root, actionKey)}`,
  ]);
}

function collect(projections: MarkUpsertProjection[]) {
  return (batch: TrademarkProjection[]) => {
    projections.push(...batch.filter((item) => item.kind === "upsert"));
    return Promise.resolve(batchResult(batch.length));
  };
}

const batchResult = (appliedRecordCount = 0) => ({
  appliedRecordCount,
  firstError: null,
  materialChangeCount: appliedRecordCount,
  unresolvedRecordCount: 0,
});

test("streams an authentic annual Class 025 record into a direct projection", async () => {
  const record = await readFile(
    "fixtures/uspto/records/annual-2025-large-class025-tx-74668071.xml",
    "utf8"
  );
  const projections: MarkUpsertProjection[] = [];
  const result = await streamTrademarkProjections({
    coordinate,
    onBatch: collect(projections),
    xml: document(record),
  });
  expect(result).toMatchObject({
    materialChangeCount: 1,
    physicalRecordCount: 1,
    projectedMarkCount: 1,
  });
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
  const projections: MarkUpsertProjection[] = [];
  const result = await streamTrademarkProjections({
    coordinate,
    onBatch: collect(projections),
    xml: document(record),
  });
  expect(result).toMatchObject({
    materialChangeCount: 1,
    physicalRecordCount: 1,
    projectedMarkCount: 1,
  });
  expect(projections[0]).toMatchObject({
    classes: [{ internationalCode: "025", statusCode: "6", statusDate: null }],
    serialNumber: "74800000",
    wordMark: "GRIGIOPERLA",
  });
});

test("does not treat a pre-1973 United States primary code as International Class 025", async () => {
  const record = await readFile(
    "fixtures/uspto/records/annual-2025-repeated-international-codes-tx-71060608.xml",
    "utf8"
  );
  const decisions: TrademarkProjection[] = [];
  const result = await streamTrademarkProjections({
    coordinate,
    onBatch: (batch) => {
      decisions.push(...batch);
      return Promise.resolve(batchResult(batch.length));
    },
    xml: document(record),
  });
  expect(result).toMatchObject({
    materialChangeCount: 1,
    physicalRecordCount: 1,
    projectedMarkCount: 0,
  });
  expect(decisions).toEqual([
    expect.objectContaining({ kind: "observe", serialNumber: "71060608" }),
  ]);
});

test("primary-class-only selection changes alter the snapshot identity", async () => {
  const project = async (primaryCode: string) => {
    const projections: TrademarkProjection[] = [];
    const record = `<case-file><serial-number>12345678</serial-number><transaction-date>20250103</transaction-date><case-file-header><filing-date>20200101</filing-date><mark-identification>SHIRT</mark-identification></case-file-header><classifications><primary-code>${primaryCode}</primary-code><status-code>6</status-code></classifications></case-file>`;
    await streamTrademarkProjections({
      coordinate,
      onBatch: (batch) => {
        projections.push(...batch);
        return Promise.resolve(batchResult(batch.length));
      },
      xml: document(record),
    });
    return projections[0];
  };

  const tracked = await project("025");
  const untracked = await project("026");
  expect(tracked?.kind).toBe("upsert");
  expect(tracked).toMatchObject({ classes: [{ internationalCode: "025" }] });
  expect(untracked?.kind).toBe("observe");
  expect(tracked?.snapshotHash).not.toBe(untracked?.snapshotHash);
});

test("deduplicates identical status events while preserving distinct transitions", async () => {
  const event =
    "<case-file-event-statement><code>DOCK</code><type>D</type><description-text>ASSIGNED TO EXAMINER</description-text><date>20250101</date><number>1</number></case-file-event-statement>";
  const distinctEvent =
    "<case-file-event-statement><code>CNRT</code><type>F</type><description-text>NON-FINAL ACTION MAILED</description-text><date>20250102</date><number>2</number></case-file-event-statement>";
  const record = `<case-file><serial-number>12345678</serial-number><transaction-date>20250103</transaction-date><case-file-header><mark-identification>SHIRT</mark-identification><status-code>700</status-code></case-file-header><case-file-event-statements>${event}${event}${distinctEvent}</case-file-event-statements><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>`;
  const projections: MarkUpsertProjection[] = [];
  await streamTrademarkProjections({
    coordinate,
    onBatch: collect(projections),
    xml: document(record),
  });

  expect(projections[0]?.statusEvents.map(({ code }) => code)).toEqual(["DOCK", "CNRT"]);
});

test("status event order does not change logical snapshot identity", async () => {
  const first =
    "<case-file-event-statement><code>DOCK</code><date>20250101</date></case-file-event-statement>";
  const second =
    "<case-file-event-statement><code>CNRT</code><date>20250102</date></case-file-event-statement>";
  const project = async (events: string) => {
    const projections: MarkUpsertProjection[] = [];
    const record = `<case-file><serial-number>12345678</serial-number><transaction-date>20250103</transaction-date><case-file-header><mark-identification>SHIRT</mark-identification></case-file-header><case-file-event-statements>${events}</case-file-event-statements><classifications><international-code>025</international-code></classifications></case-file>`;
    await streamTrademarkProjections({
      coordinate,
      onBatch: collect(projections),
      xml: document(record),
    });
    return projections[0]?.snapshotHash;
  };

  expect(await project(first + second)).toBe(await project(second + first));
});

test("projects a synthetic Class 025 record under documented 00 transport framing", async () => {
  const dailyCoordinate = {
    contentRevision: 1,
    filename: "synthetic-daily.xml",
    parserVersion: "uspto-projection-v2",
    product: "TRTDXFAP" as const,
    sha256: "b".repeat(64),
  };
  const record =
    "<case-file><serial-number>12345678</serial-number><transaction-date>20260106</transaction-date><case-file-header><mark-identification>PROTOCOL TEST MARK</mark-identification><status-code>700</status-code></case-file-header><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>";
  const projections: MarkUpsertProjection[] = [];
  const result = await streamTrademarkProjections({
    coordinate: dailyCoordinate,
    onBatch: collect(projections),
    xml: document(record, validVersion, "trademark-applications-daily", "00"),
  });

  expect(result).toMatchObject({
    materialChangeCount: 1,
    physicalRecordCount: 1,
    projectedMarkCount: 1,
  });
  expect(projections).toEqual([
    expect.objectContaining({ serialNumber: "12345678", wordMark: "PROTOCOL TEST MARK" }),
  ]);
});

test("records recency without deleting a mark that is no longer Class 025", async () => {
  const record = await readFile("fixtures/uspto/records/daily-na-98763166.xml", "utf8");
  const decisions: TrademarkProjection[] = [];
  const result = await streamTrademarkProjections({
    coordinate: {
      contentRevision: 1,
      filename: "apc240925.zip",
      parserVersion: "uspto-projection-v2",
      product: "TRTDXFAP",
      sha256: "b".repeat(64),
    },
    onBatch: (batch) => {
      decisions.push(...batch);
      return Promise.resolve(batchResult(batch.length));
    },
    xml: document(record, validVersion, "trademark-applications-daily", "NA"),
  });

  expect(result).toMatchObject({
    materialChangeCount: 1,
    physicalRecordCount: 1,
    projectedMarkCount: 0,
  });
  expect(decisions).toEqual([
    expect.objectContaining({ kind: "observe", serialNumber: "98763166" }),
  ]);
});

test("validates the authentic annual part 49 maximum record without selecting it", async () => {
  const record = await readFile(
    "fixtures/uspto/records/annual-2025-largest-record-tx-85951867.xml",
    "utf8"
  );
  const projections: MarkUpsertProjection[] = [];
  const result = await streamTrademarkProjections({
    coordinate,
    onBatch: collect(projections),
    xml: document(record),
  });
  expect(result).toMatchObject({
    materialChangeCount: 1,
    physicalRecordCount: 1,
    projectedMarkCount: 0,
  });
  expect(projections).toEqual([]);
});

test("reports a malformed physical record without rejecting the document", async () => {
  const record =
    "<case-file><transaction-date>20250101</transaction-date><case-file-header><mark-identification>SHIRT</mark-identification></case-file-header><classifications><primary-code>025</primary-code></classifications></case-file>";
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document(record),
    })
  ).resolves.toMatchObject({ physicalRecordCount: 1, unresolvedRecordCount: 1 });
});

test("rejects the wrong source document root", async () => {
  const preamble = await readFile("fixtures/uspto/prologs/application-v2-current.xml", "utf8");
  expect(Buffer.byteLength(preamble)).toBe(14_700);
  const record =
    "<case-file><serial-number>12345678</serial-number><case-file-header><mark-identification>SHIRT</mark-identification><status-code>700</status-code></case-file-header><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>";
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: Readable.from([preamble, documentBody(record, validVersion, "unexpected-root")]),
    })
  ).rejects.toThrow("trademark-applications-daily");
});

test("accepts the authentic annual declaration and internal DTD before the root", async () => {
  const preamble = await readFile("fixtures/uspto/prologs/application-v2-current.xml", "utf8");
  expect(Buffer.byteLength(preamble)).toBe(14_700);
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: Readable.from([preamble, documentBody("")]),
    })
  ).resolves.toMatchObject({
    materialChangeCount: 0,
    physicalRecordCount: 0,
    projectedMarkCount: 0,
  });
});

test("rejects missing, duplicate, and unsupported source versions", async () => {
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document("", ""),
    })
  ).rejects.toThrow("version-no must occur exactly once");
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document("", `${validVersion}${validVersion}`),
    })
  ).rejects.toThrow("version-no must occur exactly once");
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document(
        "",
        "<version><version-no>1.0</version-no><version-date>20041108</version-date></version>"
      ),
    })
  ).rejects.toThrow("Unsupported USPTO XML version");
});

test("rejects records before document version without applying a batch", async () => {
  let batchCount = 0;
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: () => {
        batchCount += 1;
        return Promise.resolve(batchResult());
      },
      xml: Readable.from([
        `<trademark-applications-daily><application-information><file-segments><file-segment>1</file-segment><action-keys><action-key>TX</action-key><case-file /></action-keys></file-segments></application-information>${validVersion}</trademark-applications-daily>`,
      ]),
    })
  ).rejects.toThrow("version-no must occur exactly once before records");
  expect(batchCount).toBe(0);
});

test("rejects missing, duplicate, and unsupported source version dates", async () => {
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document("", "<version><version-no>2.0</version-no></version>"),
    })
  ).rejects.toThrow("version-date must occur exactly once");
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document(
        "",
        "<version><version-no>2.0</version-no><version-date>20041108</version-date><version-date>20041108</version-date></version>"
      ),
    })
  ).rejects.toThrow("version-date must occur exactly once");
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document(
        "",
        "<version><version-no>2.0</version-no><version-date>20251231</version-date></version>"
      ),
    })
  ).rejects.toThrow("Unsupported USPTO XML version date");
});

test("reports an eight-digit record date that is not a calendar date", async () => {
  const record =
    "<case-file><serial-number>12345678</serial-number><transaction-date>20250230</transaction-date><case-file-header><mark-identification>SHIRT</mark-identification><status-code>700</status-code></case-file-header><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>";
  await expect(
    streamTrademarkProjections({
      coordinate,
      onBatch: async () => batchResult(),
      xml: document(record),
    })
  ).resolves.toMatchObject({
    firstError: expect.stringContaining("transaction-date is not a calendar date"),
    unresolvedRecordCount: 1,
  });
});

test("flushes direct projections in fixed batches", async () => {
  const record = (index: number) =>
    `<case-file><serial-number>${String(index).padStart(8, "0")}</serial-number><transaction-date>20250101</transaction-date><case-file-header><mark-identification>SHIRT ${index}</mark-identification><status-code>700</status-code><status-date>20250101</status-date></case-file-header><classifications><primary-code>025</primary-code><international-code>025</international-code></classifications></case-file>`;
  const sizes: number[] = [];
  const result = await streamTrademarkProjections({
    coordinate,
    onBatch: (batch) => {
      sizes.push(batch.length);
      return Promise.resolve(batchResult(batch.length));
    },
    xml: document(Array.from({ length: 251 }, (_, index) => record(index + 1)).join("")),
  });
  expect(result).toEqual({
    appliedRecordCount: 251,
    firstError: null,
    materialChangeCount: 251,
    physicalRecordCount: 251,
    projectedMarkCount: 251,
    unresolvedRecordCount: 0,
  });
  expect(sizes).toEqual([250, 1]);
});
