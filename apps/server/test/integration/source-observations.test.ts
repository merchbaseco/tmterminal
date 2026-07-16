import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { createSourceObservationModule } from "../../src/ingestion/source-observations.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 4, prepare: false });
const fixtureRoot = join(import.meta.dir, "../../../../fixtures/uspto/records");
const prologFixture = join(
  import.meta.dir,
  "../../../../fixtures/uspto/prologs/application-v2-current.xml"
);
const correspondentPattern = /<correspondent>[\s\S]*?<\/correspondent>/;
const serialNumberElementPattern = /\s*<serial-number>[^<]*<\/serial-number>/;
const caseFileClosePattern = /\s*<\/case-file>\s*$/;

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

async function retainAnnualFixture(
  filename: string,
  options: {
    actionKey?: string;
    productId?: "TRTDXFAP" | "TRTYRAP";
    recordTransform?: (record: Buffer) => Buffer;
    schemaVersion?: string;
  } = {}
) {
  const retainedRecord = await readFile(join(fixtureRoot, filename));
  const record = options.recordTransform?.(retainedRecord) ?? retainedRecord;
  const xml = Buffer.concat([
    Buffer.from(
      `<trademark-applications-daily><version><version-no>${options.schemaVersion ?? "2.0"}</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>${options.actionKey ?? "TX"}</action-key>\n`
    ),
    record,
    Buffer.from(
      "</action-keys></file-segments></application-information></trademark-applications-daily>"
    ),
  ]);
  const artifactVersionId = await retainXml(filename, xml, options.productId);
  return { artifactVersionId, record, xml };
}

async function retainXml(
  filename: string,
  xml: Buffer,
  productId: "TRTDXFAP" | "TRTYRAP" = "TRTYRAP"
) {
  const artifactId = randomUUID();
  const artifactVersionId = randomUUID();
  await database`insert into dataset_product (id) values (${productId}) on conflict do nothing`;
  await database`
    insert into artifact (id, product_id, filename)
    values (${artifactId}, ${productId}, ${filename})
  `;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key)
    values (
      ${artifactVersionId}, ${artifactId},
      ${createHash("sha256").update(xml).digest("hex")}, ${xml.byteLength}, ${`fixtures/${filename}`}
    )
  `;
  return artifactVersionId;
}

function chunked(bytes: Uint8Array, chunkSize: number) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function interrupted(bytes: Uint8Array) {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(bytes.subarray(0, Math.floor(bytes.byteLength / 2)));
        return;
      }
      controller.error(new Error("fixture stream interrupted"));
    },
  });
}

function gated(bytes: Uint8Array) {
  let release!: () => void;
  let started!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pulled = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        started();
        await released;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  return { pulled, release, stream };
}

async function remainingBytes(stream: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

test("scans a valid non-025 annual record without persisting an observation", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml");
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 37),
  });

  expect(result).toMatchObject({
    recordCount: 1,
    rejectCount: 0,
    status: "staged",
  });
  expect(result.digest).toBe("29bd0cc53810694a0d4d7b3dfd6788352afaf6876e1531fea6dcd11c1965d518");
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("persists a lossless full observation with explicit primary Class 025 and mark text", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: (record) =>
      Buffer.from(
        record
          .toString("utf8")
          .replace("<primary-code>009</primary-code>", "<primary-code>025</primary-code>")
      ),
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 37),
  });
  const records = await Array.fromAsync(observations.readRecords(result.parseRunId));

  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    actionKey: "TX",
    actionOccurrence: 1,
    actionRecordIndex: 1,
    digest: createHash("sha256").update(fixture.record).digest("hex"),
    physicalRecordIndex: 1,
    profile: "annual-tx-full-v1",
    schemaVersion: "2.0",
    schemaVersionDate: "20041108",
    serialNumber: "60146682",
    sourceTransactionDate: "2016-03-16",
    sourceTransactionDateRaw: "20160316",
  });
  expect(records[0]?.claims).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: "set",
        path: "case-file/registration-number",
        presence: "value",
        rawValue: "0146682",
      }),
      expect.objectContaining({
        operation: "set",
        path: "case-file/case-file-header/mark-identification",
        presence: "value",
        rawValue: "MACHINE-PISTOL",
      }),
      expect.objectContaining({
        operation: "replace",
        path: "case-file/case-file-statements",
        presence: "group",
      }),
      expect.objectContaining({
        operation: "replace",
        path: "case-file/classifications",
        presence: "group",
      }),
      expect.objectContaining({
        operation: "replace",
        path: "case-file/case-file-owners",
        presence: "group",
      }),
      expect.objectContaining({
        operation: null,
        path: "case-file/case-file-owners/case-file-owner/name-change-explanation",
        presence: "empty",
        rawValue: "",
      }),
    ])
  );
  const root = required(records[0]?.values[0], "expected retained source value");
  const classifications = required(
    root.children?.find((value) => value.name === "classifications"),
    "expected classifications"
  );
  const classification = required(classifications.children?.[0], "expected classification");
  expect(classification.children?.find((value) => value.name === "primary-code")?.rawValue).toBe(
    "025"
  );
  expect(
    classification.children
      ?.filter((value) => value.name === "us-code")
      .map((value) => value.rawValue)
  ).toEqual(["021", "023", "026", "036", "038"]);
});

test("scans a status-only annual TX without persisting an observation", async () => {
  const fixture = await retainAnnualFixture("annual-2025-status-only-tx-60000001.xml");
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 29),
  });
  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("scans primary Class 025 without mark text without persisting an observation", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: (record) =>
      Buffer.from(
        record
          .toString("utf8")
          .replace("<primary-code>009</primary-code>", "<primary-code>025</primary-code>")
          .replace("<mark-identification>MACHINE-PISTOL</mark-identification>", "")
      ),
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 31),
  });

  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("scans primary Class 025 with XML-encoded whitespace mark text without persisting", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: (record) =>
      Buffer.from(
        record
          .toString("utf8")
          .replace("<primary-code>009</primary-code>", "<primary-code>025</primary-code>")
          .replace(
            "<mark-identification>MACHINE-PISTOL</mark-identification>",
            "<mark-identification>&#32;&#x20;</mark-identification>"
          )
      ),
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 31),
  });

  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("scans an official sparse annual TX outside the Class 025 corpus", async () => {
  const fixture = await retainAnnualFixture("annual-2025-sparse-tx-70165419.xml");
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 43),
  });
  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("scans an official sparse daily IB outside the Class 025 corpus", async () => {
  const fixture = await retainAnnualFixture("daily-ib-sparse-85127660.xml", {
    actionKey: "IB",
    productId: "TRTDXFAP",
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 43),
  });
  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("retries the same parser after an unexpected stream failure", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml");
  const observations = createSourceObservationModule(database);

  await expect(
    observations.stageArtifact({
      artifactVersionId: fixture.artifactVersionId,
      xml: interrupted(fixture.xml),
    })
  ).rejects.toThrow("fixture stream interrupted");

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 37),
  });
  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
});

test("returns a staged parse result on redelivery without consuming the supplied stream", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml");
  const observations = createSourceObservationModule(database);
  const first = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 37),
  });
  const marker = Buffer.from("must remain unread");
  const redelivery = chunked(marker, marker.byteLength);

  const second = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: redelivery,
  });

  expect(second).toEqual(first);
  expect(await remainingBytes(redelivery)).toEqual(marker);
});

test("Class 025 selection uses a new parser version instead of reusing an all-class v2 run", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml");
  await database`
    insert into parse_run (
      id, artifact_version_id, state, parser_version, digest, record_count, reject_count, finished_at
    ) values (
      ${randomUUID()}, ${fixture.artifactVersionId}, 'staged', 'uspto-application-xml-v2',
      ${"0".repeat(64)}, 0, 0, now()
    )
  `;

  const result = await createSourceObservationModule(database).stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 37),
  });
  const versions = await database<Array<{ parserVersion: string }>>`
    select parser_version as "parserVersion"
    from parse_run
    where artifact_version_id = ${fixture.artifactVersionId}
    order by parser_version
  `;

  expect(result).toMatchObject({ recordCount: 1, status: "staged" });
  expect([...versions]).toEqual([
    { parserVersion: "uspto-application-xml-v2" },
    { parserVersion: "uspto-application-xml-v3" },
  ]);
});

test("returns a quarantined parse result on redelivery without consuming the supplied stream", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    actionKey: "ZZ",
  });
  const observations = createSourceObservationModule(database);
  const first = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 37),
  });
  const marker = Buffer.from("must remain unread");
  const redelivery = chunked(marker, marker.byteLength);

  const second = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: redelivery,
  });

  expect(second).toEqual(first);
  expect(await remainingBytes(redelivery)).toEqual(marker);
});

test("concurrent malformed deliveries converge on one quarantined run and reject", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: (record) =>
      Buffer.from(record.toString("utf8").replace("</status-code>", "</status-date>")),
  });
  const observations = createSourceObservationModule(database);
  const oversizedXml = Buffer.from(
    fixture.xml
      .toString("utf8")
      .replace(
        "</case-file>",
        `<correspondent>${"A".repeat(2 * 1024 * 1024)}</correspondent></case-file>`
      )
  );
  const firstInput = gated(oversizedXml);
  const firstCall = observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: firstInput.stream,
  });
  await firstInput.pulled;
  const secondCall = observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, fixture.xml.byteLength),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  firstInput.release();

  const [first, second] = await Promise.all([firstCall, secondCall]);

  expect(second).toEqual(first);
  expect(first).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(await Array.fromAsync(observations.readRejects(first.parseRunId))).toHaveLength(1);
  const [counts] = await database<[{ rejects: number; runs: number }]>`
    select
      (select count(*)::int from parse_run where artifact_version_id = ${fixture.artifactVersionId}) as runs,
      (select count(*)::int from parse_reject) as rejects
  `;
  expect(counts).toEqual({ rejects: 1, runs: 1 });
});

test("preserves present-empty separately from an unmentioned group", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: (sourceRecord) =>
      Buffer.from(
        sourceRecord
          .toString("utf8")
          .replace("<primary-code>009</primary-code>", "<primary-code>025</primary-code>")
          .replace(correspondentPattern, "<correspondent></correspondent>")
      ),
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 31),
  });
  const [record] = await Array.fromAsync(observations.readRecords(result.parseRunId));
  const root = required(record?.values[0], "expected retained source value");
  const correspondent = root.children?.find((value) => value.name === "correspondent");

  expect(record).toMatchObject({
    digest: createHash("sha256").update(fixture.record).digest("hex"),
    profile: "annual-tx-full-v1",
  });
  expect(correspondent).toEqual({ name: "correspondent", presence: "empty", rawValue: "" });
  expect(record?.claims).toContainEqual({
    occurrence: 1,
    operation: null,
    path: "case-file/correspondent",
    presence: "empty",
    rawValue: "",
  });
});

test("quarantines an unsupported action with its exact rejected XML", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    actionKey: "ZZ",
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 23),
  });
  const records = await Array.fromAsync(observations.readRecords(result.parseRunId));
  const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));
  const rejection = required(reject, "expected unsupported-action rejection");

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(records).toEqual([]);
  expect(reject).toMatchObject({
    bytes: fixture.record.byteLength,
    digest: "4bea4c8e9493c6945b1734a6f5eb3075256519fd5e463e704545d8867356d636",
    physicalRecordIndex: 1,
    reason: "unsupported source shape",
  });
  expect([...Buffer.from(rejection.rawXml)]).toEqual([...fixture.record]);
});

test.each([
  {
    name: "malformed XML",
    reason: "malformed XML",
    transform: (record: Buffer) =>
      Buffer.from(record.toString("utf8").replace("</status-code>", "</status-date>")),
  },
  {
    name: "ambiguous identity",
    reason: "ambiguous serial-number",
    transform: (record: Buffer) =>
      Buffer.from(
        record
          .toString("utf8")
          .replace("</serial-number>", "</serial-number><serial-number>99999999</serial-number>")
      ),
  },
  {
    name: "missing identity",
    reason: "missing mandatory case identity",
    transform: (record: Buffer) =>
      Buffer.from(record.toString("utf8").replace(serialNumberElementPattern, "")),
  },
  {
    name: "truncated XML",
    reason: "malformed or truncated XML",
    transform: (record: Buffer) =>
      Buffer.from(record.toString("utf8").replace(caseFileClosePattern, "")),
  },
])("quarantines $name without retaining eligible observations", async ({ reason, transform }) => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: transform,
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 19),
  });
  const records = await Array.fromAsync(observations.readRecords(result.parseRunId));
  const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));
  const rejection = required(reject, `expected ${reason} rejection`);

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(records).toEqual([]);
  expect(reject).toMatchObject({
    bytes: fixture.record.byteLength,
    physicalRecordIndex: 1,
    reason,
  });
  expect([...Buffer.from(rejection.rawXml)]).toEqual([...fixture.record]);
});

test("quarantines a malformed non-025 record atomically with its exact bytes", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: (record) =>
      Buffer.from(
        record
          .toString("utf8")
          .replace("</status-code>", "</status-code><status-code>999</status-code>")
      ),
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 61),
  });
  const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));
  const rejection = required(reject, "expected malformed non-025 rejection");

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(reject).toMatchObject({
    bytes: fixture.record.byteLength,
    reason: "ambiguous case-file/case-file-header/status-code",
  });
  expect([...Buffer.from(rejection.rawXml)]).toEqual([...fixture.record]);
  const [records] = await database<Array<{ count: number }>>`
    select count(*)::int as count from source_record where parse_run_id = ${result.parseRunId}
  `;
  expect(records?.count).toBe(0);
});

test("stages records beyond one persistence batch without losing order", async () => {
  const retained = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  const record = Buffer.from(
    retained
      .toString("utf8")
      .replace("<primary-code>009</primary-code>", "<primary-code>025</primary-code>")
  );
  const repeated = Array.from({ length: 101 }, () => record);
  const xml = Buffer.concat([
    Buffer.from(
      "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>TX</action-key>\n"
    ),
    ...repeated,
    Buffer.from(
      "</action-keys></file-segments></application-information></trademark-applications-daily>"
    ),
  ]);
  const artifactVersionId = await retainXml("batch-boundary.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({ artifactVersionId, xml: chunked(xml, 8191) });
  const records = await Array.fromAsync(observations.readRecords(result.parseRunId));

  expect(result).toMatchObject({ recordCount: 101, rejectCount: 0, status: "staged" });
  expect(records.at(-1)).toMatchObject({ actionRecordIndex: 101, physicalRecordIndex: 101 });
});

test("bounds one huge incoming chunk while quarantining an oversized record with exact bytes", async () => {
  const fixture = await retainAnnualFixture("annual-2025-status-only-tx-60000001.xml", {
    recordTransform(record) {
      return Buffer.from(
        record
          .toString("utf8")
          .replace(
            "</case-file>",
            `<correspondent>${"A".repeat(2 * 1024 * 1024)}</correspondent></case-file>`
          )
      );
    },
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, fixture.xml.byteLength),
  });
  const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));
  const rejection = required(reject, "expected oversized-record rejection");

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(reject).toMatchObject({ reason: "record exceeds 524288 byte limit" });
  expect(rejection.bytes).toBeGreaterThan(512 * 1024);
  expect(rejection.bytes).toBeLessThanOrEqual(512 * 1024 + 64 * 1024);
  expect(
    Buffer.compare(
      Buffer.from(rejection.rawXml),
      Buffer.from(fixture.record.subarray(0, rejection.bytes))
    )
  ).toBe(0);
});

test("bounds an unterminated outer XML token", async () => {
  const xml = Buffer.from(
    `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>${"A".repeat(2 * 1024 * 1024)}`
  );
  const artifactVersionId = await retainXml("unterminated-outer-token.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId,
    xml: chunked(xml, xml.byteLength),
  });
  const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(reject).toMatchObject({ reason: "outer XML token exceeds 65536 byte limit" });
  expect(reject?.bytes).toBeGreaterThan(64 * 1024);
  expect(reject?.bytes).toBeLessThanOrEqual(128 * 1024);
});

test("accepts predefined and numeric XML entities", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: (record) =>
      Buffer.from(
        record.toString("utf8").replace("MACHINE-PISTOL", "MACHINE &amp; PISTOL &#38; &#x26;")
      ),
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 47),
  });

  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
});

test.each([
  {
    name: "a bare ampersand",
    reason: "invalid XML entity",
    transform: (record: Buffer) =>
      Buffer.from(record.toString("utf8").replace("MACHINE-PISTOL", "MACHINE & PISTOL")),
  },
  {
    name: "an undefined entity",
    reason: "invalid XML entity",
    transform: (record: Buffer) =>
      Buffer.from(record.toString("utf8").replace("MACHINE-PISTOL", "MACHINE &turtle; PISTOL")),
  },
  {
    name: "an invalid numeric entity",
    reason: "invalid XML entity",
    transform: (record: Buffer) =>
      Buffer.from(record.toString("utf8").replace("MACHINE-PISTOL", "MACHINE &#0; PISTOL")),
  },
  {
    name: "invalid UTF-8",
    reason: "invalid UTF-8",
    transform(record: Buffer) {
      const marker = record.indexOf("MACHINE-PISTOL");
      return Buffer.concat([
        record.subarray(0, marker),
        Buffer.from([0xc3, 0x28]),
        record.subarray(marker + 2),
      ]);
    },
  },
])("quarantines $name with its exact record bytes", async ({ reason, transform }) => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    recordTransform: transform,
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 53),
  });
  const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));
  const rejection = required(reject, `expected ${reason} envelope rejection`);

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(reject).toMatchObject({ bytes: fixture.record.byteLength, reason });
  expect([...Buffer.from(rejection.rawXml)]).toEqual([...fixture.record]);
});

test.each([
  ["NUL", 0x00],
  ["U+0001", 0x01],
] as const)(
  "quarantines literal XML 1.0 control %s with its exact record bytes",
  async (_name, codePoint) => {
    const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
      recordTransform(record) {
        const marker = record.indexOf("MACHINE-PISTOL");
        return Buffer.concat([
          record.subarray(0, marker),
          Buffer.from([codePoint]),
          record.subarray(marker),
        ]);
      },
    });
    const observations = createSourceObservationModule(database);

    const result = await observations.stageArtifact({
      artifactVersionId: fixture.artifactVersionId,
      xml: chunked(fixture.xml, 59),
    });
    const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));
    const rejection = required(reject, "expected invalid XML character rejection");

    expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
    expect(reject).toMatchObject({
      bytes: fixture.record.byteLength,
      reason: "invalid XML character",
    });
    expect([...Buffer.from(rejection.rawXml)]).toEqual([...fixture.record]);
  }
);

test("stages the official XML declaration and internal DTD envelope", async () => {
  const record = await readFile(join(fixtureRoot, "annual-2025-status-only-tx-60000001.xml"));
  const officialProlog = await readFile(prologFixture);
  expect(createHash("sha256").update(officialProlog).digest("hex")).toBe(
    "876d99040deed52e74072ba3e547a9c3d782fd31f41b3900e1fdc3a0433aa524"
  );
  const xml = Buffer.concat([
    officialProlog,
    Buffer.from(
      "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>TX</action-key>\n"
    ),
    record,
    Buffer.from(
      "</action-keys></file-segments></application-information></trademark-applications-daily>"
    ),
  ]);
  const artifactVersionId = await retainXml("official-prolog.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({ artifactVersionId, xml: chunked(xml, 67) });

  expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
});

test.each([
  ["text before the root", (xml: string) => `not XML${xml}`],
  ["text after the root", (xml: string) => `${xml}not XML`],
  [
    "a misplaced XML declaration",
    (xml: string) => xml.replace("<version>", '<?xml version="1.0" encoding="utf-8"?><version>'),
  ],
] as const)("quarantines %s", async (_name, transform) => {
  const valid =
    "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><data-available-code>N</data-available-code></application-information></trademark-applications-daily>";
  const xml = Buffer.from(transform(valid));
  const artifactVersionId = await retainXml("invalid-prolog.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({ artifactVersionId, xml: chunked(xml, 17) });

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
});

test("preserves global and action-local order across repeated action groups", async () => {
  const retained = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  const first = Buffer.from(
    retained
      .toString("utf8")
      .replace("<primary-code>009</primary-code>", "<primary-code>025</primary-code>")
  );
  const second = Buffer.from(first.toString("utf8").replaceAll("60146682", "60146683"));
  const xml = Buffer.concat([
    Buffer.from(
      "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>TX</action-key>\n"
    ),
    first,
    Buffer.from("</action-keys><action-keys><action-key>TX</action-key>\n"),
    second,
    Buffer.from(
      "</action-keys></file-segments></application-information></trademark-applications-daily>"
    ),
  ]);
  const artifactVersionId = await retainXml("two-tx-groups.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({ artifactVersionId, xml: chunked(xml, 17) });
  const records = await Array.fromAsync(observations.readRecords(result.parseRunId));

  expect(result).toMatchObject({ recordCount: 2, rejectCount: 0, status: "staged" });
  expect(
    records.map(({ actionKey, actionOccurrence, actionRecordIndex, physicalRecordIndex }) => ({
      actionKey,
      actionOccurrence,
      actionRecordIndex,
      physicalRecordIndex,
    }))
  ).toEqual([
    { actionKey: "TX", actionOccurrence: 1, actionRecordIndex: 1, physicalRecordIndex: 1 },
    { actionKey: "TX", actionOccurrence: 2, actionRecordIndex: 1, physicalRecordIndex: 2 },
  ]);
});

test("stages a valid no-data artifact with zero records", async () => {
  const xml = Buffer.from(
    "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><data-available-code>N</data-available-code></application-information></trademark-applications-daily>"
  );
  const artifactVersionId = await retainXml("no-data.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({ artifactVersionId, xml: chunked(xml, 11) });

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 0, status: "staged" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test.each([
  [
    "mismatched outer tags",
    "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><data-available-code>N</data-available-code></trademark-applications-daily></application-information>",
  ],
  [
    "action key outside its group",
    "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-key>TX</action-key></file-segments></application-information></trademark-applications-daily>",
  ],
  [
    "multiple keys for one action group",
    "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>TX</action-key><action-key>NA</action-key></action-keys></file-segments></application-information></trademark-applications-daily>",
  ],
  [
    "arbitrary empty application envelope",
    "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information></application-information></trademark-applications-daily>",
  ],
] as const)("quarantines %s", async (_name, source) => {
  const xml = Buffer.from(source);
  const artifactVersionId = await retainXml("invalid-envelope.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({ artifactVersionId, xml: chunked(xml, 7) });

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("quarantines a case-file outside an action group", async () => {
  const record = await readFile(join(fixtureRoot, "annual-2025-status-only-tx-60000001.xml"));
  const xml = Buffer.concat([
    Buffer.from(
      "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment>\n"
    ),
    record,
    Buffer.from("</file-segments></application-information></trademark-applications-daily>"),
  ]);
  const artifactVersionId = await retainXml("ungrouped-record.xml", xml);
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({ artifactVersionId, xml: chunked(xml, 9) });

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(await Array.fromAsync(observations.readRecords(result.parseRunId))).toEqual([]);
});

test("quarantines an unsupported schema before any observation becomes eligible", async () => {
  const fixture = await retainAnnualFixture("annual-2025-full-tx-60146682.xml", {
    schemaVersion: "9.9",
  });
  const observations = createSourceObservationModule(database);

  const result = await observations.stageArtifact({
    artifactVersionId: fixture.artifactVersionId,
    xml: chunked(fixture.xml, 13),
  });
  const [reject] = await Array.fromAsync(observations.readRejects(result.parseRunId));

  expect(result).toMatchObject({ recordCount: 0, rejectCount: 1, status: "quarantined" });
  expect(reject).toMatchObject({
    digest: "4bea4c8e9493c6945b1734a6f5eb3075256519fd5e463e704545d8867356d636",
    reason: "unsupported root or schema version",
  });
});

test.each([
  [
    "daily-ib-72269147.xml",
    "IB",
    "72269147",
    "a2c21edd3eefb229bc9e3ae4d53b0fee017559e56a7a9c056937245d3b05f6cb",
    false,
  ],
  [
    "daily-na-98763166.xml",
    "NA",
    "98763166",
    "807cb064b83a0cd58a0e0a1859bdfef5ed15f692c6f6db0c6e5d0981c23b3067",
    false,
  ],
  [
    "goods-before-replacement-75932504.xml",
    "TX",
    "75932504",
    "99427d74682359d7abae10aae48fe39efdde96c7fbbeef55a5f21d07a0700fae",
    false,
  ],
  [
    "goods-after-replacement-75932504.xml",
    "TX",
    "75932504",
    "21a3b3e5c90b895e8a21a2cd6d6f54a0e317ca1e869fb1804663a2847aa189a9",
    false,
  ],
  [
    "revival-before-98186103.xml",
    "TX",
    "98186103",
    "34f2cec502db9074af200de2509255800f7ce83ba3781df9afa4063b5c4172ef",
    true,
  ],
  [
    "revival-after-98186103.xml",
    "TX",
    "98186103",
    "d073c5220246c0bf545272185344de056a6f9893b5018ee42d4ca7de0add6dff",
    false,
  ],
  [
    "publication-before-79366581.xml",
    "TX",
    "79366581",
    "ed48531b8cd4a06211b4a2a9183bc951ad310197b44f39c09779704ebcc93edb",
    true,
  ],
  [
    "publication-after-79366581.xml",
    "TX",
    "79366581",
    "62b9e3fc29921e295965d4bdbb32bb14c73b3bd645304d1e20f7730e83084675",
    false,
  ],
  [
    "registration-evidence-98423838.xml",
    "TX",
    "98423838",
    "512d5c578b3ae5840bbec62e68f30b38ba4d89e6d45f7ebcff04f8d89ced36b6",
    false,
  ],
  [
    "cancellation-evidence-85017257.xml",
    "TX",
    "85017257",
    "e80b9a15001fe0f0203aaa98f59333bfd3b8effc027dea6b6cc3884ff6f47b9f",
    false,
  ],
] as const)(
  "stages retained daily fixture %s with source framing and Class 025 selection",
  async (filename, actionKey, serialNumber, digest, selected) => {
    const fixture = await retainAnnualFixture(filename, { actionKey, productId: "TRTDXFAP" });
    const observations = createSourceObservationModule(database);

    const result = await observations.stageArtifact({
      artifactVersionId: fixture.artifactVersionId,
      xml: chunked(fixture.xml, 41),
    });
    const records = await Array.fromAsync(observations.readRecords(result.parseRunId));

    expect(result).toMatchObject({ recordCount: 1, rejectCount: 0, status: "staged" });
    if (!selected) {
      expect(records).toEqual([]);
      return;
    }
    const [record] = records;
    expect(record).toMatchObject({
      actionKey,
      actionOccurrence: 1,
      actionRecordIndex: 1,
      digest,
      physicalRecordIndex: 1,
      profile: `daily-${actionKey.toLowerCase()}-full-v1`,
      serialNumber,
    });
    expect(record?.claims).toContainEqual(
      expect.objectContaining({
        operation: "assert",
        path: "case-file/case-file-event-statements",
        presence: "group",
      })
    );
  }
);
