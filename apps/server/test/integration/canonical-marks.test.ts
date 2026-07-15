import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { canonicalizeMark } from "../../src/ingestion/canonical-marks.ts";
import { createCanonicalMarkRepository } from "../../src/queries/canonical-mark-repository.ts";
import { createSourceObservationModule } from "../../src/ingestion/source-observations.ts";
import type { SourceObservation } from "../../src/ingestion/source-observations.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");

const database = postgres(databaseUrl, { max: 4, prepare: false });
const fixtureRoot = join(import.meta.dir, "../../../../fixtures/uspto/records");

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function stageFixture(
  filename: string,
  productId: "TRTDXFAP" | "TRTYRAP" = "TRTYRAP",
  transform?: (record: Buffer) => Buffer,
  artifactFilename = filename,
) {
  const retainedRecord = await readFile(join(fixtureRoot, filename));
  const record = transform?.(retainedRecord) ?? retainedRecord;
  const xml = Buffer.concat([
    Buffer.from(
      `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>TX</action-key>\n`,
    ),
    record,
    Buffer.from("</action-keys></file-segments></application-information></trademark-applications-daily>"),
  ]);
  const artifactId = randomUUID();
  const artifactVersionId = randomUUID();
  const artifactSha256 = createHash("sha256").update(xml).digest("hex");
  await database`insert into dataset_product (id) values (${productId}) on conflict do nothing`;
  await database`insert into artifact (id, product_id, filename) values (${artifactId}, ${productId}, ${artifactFilename})`;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key)
    values (${artifactVersionId}, ${artifactId}, ${artifactSha256}, ${xml.byteLength}, ${`fixtures/${filename}`})
  `;
  const observations = createSourceObservationModule(database);
  const parse = await observations.stageArtifact({ artifactVersionId, xml: stream(xml) });
  return { artifactSha256, records: await Array.fromAsync(observations.readRecords(parse.parseRunId)) };
}

function withScalar(observation: SourceObservation, path: string[], value: string) {
  const changed = structuredClone(observation);
  let node = changed.values[0];
  for (const name of path) node = node?.children?.find((child) => child.name === name);
  if (!node) throw new Error(`missing fixture value ${path.join("/")}`);
  node.rawValue = value;
  const claim = changed.claims.find((item) => item.path === `case-file/${path.join("/")}`);
  if (!claim) throw new Error(`missing fixture claim ${path.join("/")}`);
  claim.rawValue = value;
  return changed;
}

test("materializes the PRD-60 annual tracer with source owner and group provenance", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml");

  const result = canonicalizeMark(fixture.records);

  expect(result).toMatchObject({
    kind: "resolved",
    versions: {
      authorityPolicy: "uspto-authority-v1",
      normalization: "uspto-normalization-v1",
      projection: "uspto-projection-v1",
      sourceProfile: "uspto-application-xml-v2.0-v1",
    },
    mark: {
      filingDate: "1920-09-25",
      markDrawingCode: "3",
      registrationDate: "1921-09-20",
      registrationNumber: "0146682",
      serialNumber: "60146682",
      statusCode: "626",
      statusDate: "2005-10-11",
      wordMark: "MACHINE-PISTOL",
    },
    classes: [{ internationalCode: "009", statusCode: "6", statusDate: "2010-04-08" }],
    goodsServices: [{ text: "pistols", typeCode: "GS0091" }],
    owners: [{ entryNumber: "1", partyName: "AUTO ORDNANCE CORPORATION", partyType: "10" }],
  });
  if (result.kind !== "resolved") throw new Error("expected resolved tracer");
  expect(result.contributors.every((contributor) => (
    contributor.product === "TRTYRAP" &&
    contributor.artifactVersionSha256 === fixture.artifactSha256 &&
    contributor.physicalRecordIndex === 1
  ))).toBe(true);
  expect(new Set(result.contributors.map((contributor) => contributor.group))).toEqual(
    new Set(["application", "classes", "goods-services", "lifecycle", "mark-presentation", "owners", "registration"]),
  );
});

test("duplicate delivery does not duplicate values or contributor coordinates", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml");
  const [observation] = fixture.records;
  if (!observation) throw new Error("missing fixture observation");

  const once = canonicalizeMark([observation]);
  const duplicated = canonicalizeMark([observation, structuredClone(observation)]);

  expect(duplicated).toEqual(once);
});

test("returns a versioned authority conflict for differing unordered annual and daily values", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml");
  const [annual] = fixture.records;
  if (!annual) throw new Error("missing fixture observation");
  const daily = withScalar(annual, ["case-file-header", "mark-identification"], "COMPETING MARK");
  daily.product = "TRTDXFAP";
  daily.profile = "daily-tx-full-v1";
  daily.artifactVersionSha256 = "f".repeat(64);

  const result = canonicalizeMark([daily, annual]);

  expect(canonicalizeMark([annual, daily])).toEqual(result);
  expect(result).toMatchObject({
    kind: "unresolved",
    diagnostics: [{
      claimPath: "case-file/case-file-header/mark-identification",
      competingValues: ["COMPETING MARK", "MACHINE-PISTOL"],
      group: "mark-presentation",
      kind: "authority-conflict",
      policyVersion: "uspto-authority-v1",
      serialNumber: "60146682",
    }],
  });
  if (result.kind !== "unresolved") throw new Error("expected unresolved overlap");
  const [diagnostic] = result.diagnostics;
  if (diagnostic?.kind !== "authority-conflict") throw new Error("expected authority conflict");
  expect(diagnostic.observations).toEqual([
    {
      artifactVersionSha256: "f".repeat(64),
      physicalRecordIndex: 1,
      product: "TRTDXFAP",
    },
    {
      artifactVersionSha256: fixture.artifactSha256,
      physicalRecordIndex: 1,
      product: "TRTYRAP",
    },
  ]);
});

test("orders the fixture-proven daily goods transition by its distinct transaction dates", async () => {
  const before = await stageFixture("goods-before-replacement-75932504.xml", "TRTDXFAP");
  const after = await stageFixture("goods-after-replacement-75932504.xml", "TRTDXFAP");

  const result = canonicalizeMark([after.records[0]!, before.records[0]!]);

  expect(canonicalizeMark([before.records[0]!, after.records[0]!])).toEqual(result);
  expect(result).toMatchObject({
    kind: "resolved",
    mark: { serialNumber: "75932504", sourceTransactionDate: "2024-09-25", statusDate: "2024-09-25" },
  });
  if (result.kind !== "resolved") throw new Error("expected resolved daily transition");
  expect(result.goodsServices).toContainEqual(expect.objectContaining({
    typeCode: "GS0091",
    text: expect.stringContaining("DISCS FOR USE WITH VIDEO GAME CONSOLES"),
  }));
  expect(result.goodsServices).toContainEqual(expect.objectContaining({ typeCode: "A00001" }));
  expect(result.contributors.filter((contributor) => contributor.claimPath === "case-file/case-file-statements"))
    .toEqual([expect.objectContaining({ artifactVersionSha256: after.artifactSha256 })]);
});

test.each([
  {
    after: "revival-after-98186103.xml",
    before: "revival-before-98186103.xml",
    event: "PETITION TO REVIVE-GRANTED",
    serialNumber: "98186103",
    statusCode: "616",
  },
  {
    after: "publication-after-79366581.xml",
    before: "publication-before-79366581.xml",
    event: "PUBLISHED FOR OPPOSITION",
    serialNumber: "79366581",
    statusCode: "686",
  },
])("orders the fixture-proven daily $serialNumber lifecycle and additive events", async (fixture) => {
  const before = await stageFixture(fixture.before, "TRTDXFAP");
  const after = await stageFixture(fixture.after, "TRTDXFAP");

  const result = canonicalizeMark([before.records[0]!, after.records[0]!]);

  expect(result).toMatchObject({
    kind: "resolved",
    mark: {
      serialNumber: fixture.serialNumber,
      sourceTransactionDate: "2024-09-25",
      statusCode: fixture.statusCode,
      statusDate: "2024-09-25",
    },
  });
  if (result.kind !== "resolved") throw new Error("expected resolved daily lifecycle transition");
  expect(result.statusEvents).toContainEqual(expect.objectContaining({ description: fixture.event }));
});

test("materializes the retained status-only annual shape without clearing unmentioned groups", async () => {
  const fixture = await stageFixture("annual-2025-status-only-tx-60000001.xml");

  const result = canonicalizeMark(fixture.records);

  expect(result).toMatchObject({
    kind: "resolved",
    classes: [],
    goodsServices: [],
    mark: {
      filingDate: null,
      registrationNumber: "0000001",
      serialNumber: "60000001",
      statusCode: "626",
      wordMark: null,
    },
    owners: [],
  });
});

test("converges lexical-equivalent scalar and collection values to decoded semantics", async () => {
  const entitySpelling = await stageFixture("annual-2025-full-tx-60146682.xml", "TRTYRAP", (record) => Buffer.from(
    record.toString("utf8")
      .replace("MACHINE-PISTOL", "MACHINE &amp; PISTOL &#38; &#x26;")
      .replace("AUTO ORDNANCE CORPORATION", "AUTO &amp; ORDNANCE CORPORATION")
      .replace("<text>pistols</text>", "<text>pistols &amp; ammunition</text>"),
  ));
  const numericSpelling = await stageFixture("annual-2025-full-tx-60146682.xml", "TRTYRAP", (record) => Buffer.from(
    record.toString("utf8")
      .replace("MACHINE-PISTOL", " MACHINE &#38; PISTOL &amp; &#38; ")
      .replace("AUTO ORDNANCE CORPORATION", " AUTO &#x26; ORDNANCE CORPORATION ")
      .replace("<text>pistols</text>", "<text> pistols &#38; ammunition </text>"),
  ), "annual-2025-full-tx-60146682-numeric-entities.xml");

  const result = canonicalizeMark([entitySpelling.records[0]!, numericSpelling.records[0]!]);

  expect(result).toMatchObject({
    kind: "resolved",
    mark: { wordMark: "MACHINE & PISTOL & &" },
    goodsServices: [{ text: "pistols & ammunition", typeCode: "GS0091" }],
    owners: [{ entryNumber: "1", partyName: "AUTO & ORDNANCE CORPORATION", partyType: "10" }],
  });
});

test("materializes documented zero dates as unknown", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml", "TRTYRAP", (record) => Buffer.from(
    record.toString("utf8")
      .replace("<filing-date>19200925</filing-date>", "<filing-date>00000000</filing-date>")
      .replace("<status-date>20100408</status-date>", "<status-date>00000000</status-date>"),
  ));
  const result = canonicalizeMark(fixture.records);

  expect(result).toMatchObject({ kind: "resolved", mark: { filingDate: null }, classes: [{ statusDate: null }] });
  if (result.kind !== "resolved") throw new Error("expected zero-date materialization");
  const repository = createCanonicalMarkRepository(database);
  await repository.replace(result);
  expect(await repository.read(result.mark.serialNumber)).toEqual(result);
});

test("rejects partial dates instead of inventing PostgreSQL dates", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml", "TRTYRAP", (record) => Buffer.from(
    record.toString("utf8")
      .replace("<filing-date>19200925</filing-date>", "<filing-date>20240900</filing-date>")
      .replace("<status-date>20100408</status-date>", "<status-date>20240008</status-date>"),
  ));

  expect(canonicalizeMark(fixture.records)).toMatchObject({
    kind: "unresolved",
    diagnostics: [{
      claimPath: "case-file/case-file-header/filing-date",
      group: "application",
      kind: "unsupported-semantics",
      operation: "set",
      presence: "value",
    }, {
      claimPath: "case-file/classifications",
      group: "classes",
      kind: "unsupported-semantics",
      operation: "replace",
      presence: "group",
    }],
  });
});

test("identical unordered values retain every contributor and ignore input permutation", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml");
  const [annual] = fixture.records;
  if (!annual) throw new Error("missing fixture observation");
  const daily = structuredClone(annual);
  daily.product = "TRTDXFAP";
  daily.profile = "daily-tx-full-v1";
  daily.artifactVersionSha256 = "e".repeat(64);

  const forward = canonicalizeMark([annual, daily]);
  const reverse = canonicalizeMark([daily, annual]);

  expect(reverse).toEqual(forward);
  if (forward.kind !== "resolved") throw new Error("expected identical values to resolve");
  expect(forward.contributors.filter((contributor) => (
    contributor.claimPath === "case-file/case-file-header/mark-identification"
  ))).toHaveLength(2);
});

test("does not infer a general daily transaction-date winner outside retained transitions", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml");
  const earlier = withScalar(fixture.records[0]!, ["transaction-date"], "20240914");
  earlier.product = "TRTDXFAP";
  earlier.profile = "daily-tx-full-v1";
  earlier.digest = "a".repeat(64);
  earlier.artifactVersionSha256 = "a".repeat(64);
  earlier.sourceTransactionDate = "2024-09-14";
  const later = withScalar(earlier, ["case-file-header", "mark-identification"], "COMPETING DAILY MARK");
  later.digest = "b".repeat(64);
  later.artifactVersionSha256 = "b".repeat(64);
  later.sourceTransactionDate = "2024-09-25";
  const datedLater = withScalar(later, ["transaction-date"], "20240925");

  const result = canonicalizeMark([earlier, datedLater]);

  expect(result).toMatchObject({ kind: "unresolved" });
  if (result.kind !== "unresolved") throw new Error("expected unproved daily overlap to conflict");
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    claimPath: "case-file/case-file-header/mark-identification",
    kind: "authority-conflict",
  }));
});

test("returns unsupported semantics for an unknown source profile", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml");
  const unknown = structuredClone(fixture.records[0]!);
  unknown.profile = "future-shape-v9";

  const result = canonicalizeMark([unknown]);

  expect(result).toMatchObject({
    kind: "unresolved",
    diagnostics: [{
      claimPath: "case-file",
      group: "mark-presentation",
      kind: "unsupported-semantics",
      operation: null,
      presence: "group",
      profile: "future-shape-v9",
      serialNumber: "60146682",
    }],
  });
});

test("returns unsupported semantics for a present-empty XML v2.0 owner group", async () => {
  const fixture = await stageFixture(
    "annual-2025-full-tx-60146682.xml",
    "TRTYRAP",
    (record) => Buffer.from(record.toString("utf8").replace(/<case-file-owners>[\s\S]*<\/case-file-owners>/, "<case-file-owners/>")),
  );

  const result = canonicalizeMark(fixture.records);

  expect(result).toMatchObject({
    kind: "unresolved",
    diagnostics: [{
      claimPath: "case-file/case-file-owners",
      group: "owners",
      kind: "unsupported-semantics",
      operation: null,
      presence: "empty",
      profile: "annual-tx-full-v1",
      serialNumber: "60146682",
    }],
  });
});

test("returns unsupported semantics for fixture groups whose collection operation is unproved", async () => {
  const fixture = await stageFixture("annual-2025-sparse-tx-70165419.xml");

  const result = canonicalizeMark(fixture.records);

  expect(result).toMatchObject({
    kind: "unresolved",
    diagnostics: [
      { claimPath: "case-file/classifications", group: "classes", kind: "unsupported-semantics" },
      { claimPath: "case-file/case-file-statements", group: "goods-services", kind: "unsupported-semantics" },
    ],
  });
});

test("returns unsupported semantics instead of inventing a scalar clear", async () => {
  const fixture = await stageFixture(
    "annual-2025-full-tx-60146682.xml",
    "TRTYRAP",
    (record) => Buffer.from(record.toString("utf8").replace(
      "<mark-identification>MACHINE-PISTOL</mark-identification>",
      "<mark-identification/>",
    )),
  );

  const result = canonicalizeMark(fixture.records);

  expect(result).toMatchObject({
    kind: "unresolved",
    diagnostics: [{
      claimPath: "case-file/case-file-header/mark-identification",
      group: "mark-presentation",
      kind: "unsupported-semantics",
      operation: null,
      presence: "empty",
    }],
  });
});

test("stores and replays canonical groups and contributor sets through the repository interface", async () => {
  const fixture = await stageFixture("annual-2025-full-tx-60146682.xml");
  const materialization = canonicalizeMark(fixture.records);
  if (materialization.kind !== "resolved") throw new Error("expected resolved tracer");
  const repository = createCanonicalMarkRepository(database);

  await repository.replace(materialization);
  await repository.replace(materialization);

  expect(await repository.read("60146682")).toEqual(materialization);
});

test("stores additive status events through the repository interface", async () => {
  const before = await stageFixture("publication-before-79366581.xml", "TRTDXFAP");
  const after = await stageFixture("publication-after-79366581.xml", "TRTDXFAP");
  const materialization = canonicalizeMark([after.records[0]!, before.records[0]!]);
  if (materialization.kind !== "resolved") throw new Error("expected resolved publication transition");
  const repository = createCanonicalMarkRepository(database);

  await repository.replace(materialization);

  expect(await repository.read("79366581")).toEqual(materialization);
});
