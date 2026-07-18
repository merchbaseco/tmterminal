import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  annualBaselineV1Artifacts,
  annualBaselineV1MetadataSha256,
} from "../apps/server/src/ingestion/annual-baseline-v1.ts";
import {
  ACTIVE_CLASS_STATUS_CODE,
  APPLICATION_DOCUMENTATION_SOURCE,
  STATUS_POLICY_ENTRIES,
  STATUS_POLICY_SOURCE,
} from "../apps/server/src/search/status-policy.ts";
import {
  assertAnnualFixturePairs,
  assertArtifactMetadataReferences,
  assertFixtureArtifactReferences,
  assertFixturePathInventory,
  assertTrademarkSourceContract,
  type TrademarkSourceContract,
} from "./uspto-fixture-manifest.ts";

interface CachedEvidence {
  bytes: number;
  path: string;
  sha256: string;
}

interface Artifact {
  cachePath: string;
  id: string;
  officialMetadata?: {
    sourceId: string;
    responseArrayIndex: number;
    generationFromDate: string;
    generationToDate: string;
  };
  product: string;
  upstreamDownloadUri: string | null;
  xml: {
    filename: string;
    bytes: number;
    sha256: string;
    recordCount: number;
    maxRecordBytes: number;
    actionRecordCounts: Record<string, number>;
    actionGroups: Array<{ actionKey: string; actionOccurrence: number; recordCount: number }>;
    transactionDateRange: { from: string; to: string };
    serialNumberRange?: { from: string; to: string };
    uniqueSerialNumberCount?: number;
    serialNumberOrder?: "ascending";
    root: { name: string; version: string; versionDate: string; creationDatetime: string };
  };
  zip: { filename: string; bytes: number; sha256: string };
}

interface OfficialProductMetadata {
  checkedAt: string;
  generationInventory: Array<{ from: string; to: string; fileCount: number }>;
  httpStatus: number;
  id: string;
  product: string;
  productFileTotalQuantity: number;
  responseBytes: number;
  responseFileCount: number;
  responseSha256: string;
  retainedResponsePath: string;
  sourceUrl: string;
}

interface AnnualFixturePair {
  fullFixtureId: string;
  generationFromDate: string;
  generationToDate: string;
  id: string;
  statusOnlyFixtureId: string;
}

interface Fixture {
  actionKey: string;
  actionOccurrence: number;
  actionRecordIndex: number;
  artifactId: string;
  bytes: number;
  evidence: string[];
  expectedPresence: {
    present: string[];
    absent: string[];
    empty: string[];
  };
  expectedValues?: Record<string, string>;
  id: string;
  path: string;
  recordIndex: number;
  sequence: string | null;
  serialNumber: string;
  sha256: string;
}

interface Manifest {
  annualFixturePairs: AnnualFixturePair[];
  artifacts: Artifact[];
  cacheRootDefault: string;
  fixtures: Fixture[];
  officialContracts: TrademarkSourceContract[];
  officialProductMetadata: OfficialProductMetadata[];
  retainedEvidence: CachedEvidence[];
  schemaVersion: number;
}

const repositoryRoot = join(import.meta.dir, "..");
const manifestPath = join(repositoryRoot, "fixtures/uspto/manifest.json");
const manifest = (await Bun.file(manifestPath).json()) as Manifest;
const writeFixtures = Bun.argv.includes("--write");
const cacheRoot = join(homedir(), "Library/Caches/tmturtle/uspto");
const rootLine = /^<([a-z][a-z0-9-]*)>\s*$/;
const caseFileOpenLine = /^\s*<case-file>\s*$/;
const caseFileCloseLine = /^\s*<\/case-file>\s*$/;

assertTrademarkSourceContract(manifest.officialContracts, {
  currentApplicationDocument: {
    activeClassStatusCode: ACTIVE_CLASS_STATUS_CODE,
    bytes: APPLICATION_DOCUMENTATION_SOURCE.bytes,
    retainedInRepository: false,
    sha256: APPLICATION_DOCUMENTATION_SOURCE.sha256,
    url: APPLICATION_DOCUMENTATION_SOURCE.url,
  },
  currentStatusTable: {
    bytes: STATUS_POLICY_SOURCE.bytes,
    dispositionSha256: createHash("sha256")
      .update(JSON.stringify(STATUS_POLICY_ENTRIES))
      .digest("hex"),
    entryCount: STATUS_POLICY_ENTRIES.length,
    retainedInRepository: false,
    sha256: STATUS_POLICY_SOURCE.sha256,
    tableUpdated: STATUS_POLICY_SOURCE.tableUpdated,
    url: STATUS_POLICY_SOURCE.url,
  },
});

assertFixtureArtifactReferences(manifest.artifacts, manifest.fixtures);
assertArtifactMetadataReferences(manifest.officialProductMetadata, manifest.artifacts);
assertAnnualFixturePairs(manifest.annualFixturePairs, manifest.artifacts, manifest.fixtures);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const readCachedBytes = async (relativePath: string) => {
  const path = join(cacheRoot, relativePath);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Missing cached evidence: ${path}`);
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), path };
};

const verifyCachedEvidence = async (evidence: CachedEvidence) => {
  const cached = await readCachedBytes(evidence.path);
  if (cached.bytes.byteLength !== evidence.bytes) {
    throw new Error(`Cached byte-size mismatch: ${cached.path}`);
  }
  if (sha256(cached.bytes) !== evidence.sha256) {
    throw new Error(`Cached SHA-256 mismatch: ${cached.path}`);
  }
};

const verifyPinnedAnnualMetadata = (
  metadata: OfficialProductMetadata,
  files: Record<string, unknown>[]
) => {
  if (metadata.id !== "TRTYRAP-product-metadata-2026-07-15") {
    return;
  }
  if (metadata.responseSha256 !== annualBaselineV1MetadataSha256) {
    throw new Error("Pinned annual policy metadata SHA-256 drift");
  }
  const pinnedBaselineFiles = files
    .filter(
      (file) => file.fileDataFromDate === "1884-04-07" && file.fileDataToDate === "2025-12-31"
    )
    .map((file) => String(file.fileName))
    .sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(pinnedBaselineFiles) !==
    JSON.stringify([...annualBaselineV1Artifacts].sort((left, right) => left.localeCompare(right)))
  ) {
    throw new Error("Pinned annual policy membership drift");
  }
};

const verifyOfficialProductMetadata = async (metadata: OfficialProductMetadata) => {
  const cached = await readCachedBytes(metadata.retainedResponsePath);
  if (
    cached.bytes.byteLength !== metadata.responseBytes ||
    sha256(cached.bytes) !== metadata.responseSha256
  ) {
    throw new Error(`Official product metadata does not match manifest: ${cached.path}`);
  }

  const response = JSON.parse(new TextDecoder().decode(cached.bytes)) as {
    bulkDataProductBag?: Array<{
      productIdentifier?: string;
      productFileTotalQuantity?: number;
      productFileBag?: { count?: number; fileDataBag?: Record<string, unknown>[] };
    }>;
  };
  const product = response.bulkDataProductBag?.find(
    (item) => item.productIdentifier === metadata.product
  );
  const files = product?.productFileBag?.fileDataBag;
  if (
    !(product && files) ||
    product.productFileTotalQuantity !== metadata.productFileTotalQuantity ||
    product.productFileBag?.count !== metadata.responseFileCount ||
    files.length !== metadata.responseFileCount
  ) {
    throw new Error(`Official product inventory drift: ${metadata.id}`);
  }
  verifyPinnedAnnualMetadata(metadata, files);

  const inventory = new Map<string, number>();
  for (const file of files) {
    const from = String(file.fileDataFromDate ?? "");
    const to = String(file.fileDataToDate ?? "");
    const key = `${from}\u0000${to}`;
    inventory.set(key, (inventory.get(key) ?? 0) + 1);
  }
  const expectedInventory = new Map(
    metadata.generationInventory.map((generation) => [
      `${generation.from}\u0000${generation.to}`,
      generation.fileCount,
    ])
  );
  if (JSON.stringify([...inventory].sort()) !== JSON.stringify([...expectedInventory].sort())) {
    throw new Error(`Official product generation inventory drift: ${metadata.id}`);
  }

  for (const artifact of manifest.artifacts.filter(
    (candidate) => candidate.officialMetadata?.sourceId === metadata.id
  )) {
    const source = artifact.officialMetadata;
    const file = source ? files[source.responseArrayIndex] : undefined;
    if (
      !source ||
      file?.fileName !== artifact.zip.filename ||
      file.fileSize !== artifact.zip.bytes ||
      file.fileDownloadURI !== artifact.upstreamDownloadUri ||
      file.fileDataFromDate !== source.generationFromDate ||
      file.fileDataToDate !== source.generationToDate ||
      file.fileTypeText !== "Data"
    ) {
      throw new Error(`Artifact metadata membership drift: ${artifact.id}`);
    }
  }
};

const tagValue = (line: string, tag: string) => {
  const match = line.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1];
};

const concat = (left: Buffer, right: Uint8Array) => Buffer.concat([left, Buffer.from(right)]);

const escapedTag = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const verifyPresence = (fixture: Fixture, excerpt: Buffer) => {
  const text = excerpt.toString("utf8");
  const hasTag = (tag: string) => new RegExp(`<${escapedTag(tag)}(?:\\s|>)`).test(text);

  for (const tag of fixture.expectedPresence.present) {
    if (!hasTag(tag)) {
      throw new Error(`Expected present element <${tag}> is missing: ${fixture.id}`);
    }
  }
  for (const tag of fixture.expectedPresence.absent) {
    if (hasTag(tag)) {
      throw new Error(`Expected absent element <${tag}> is present: ${fixture.id}`);
    }
  }
  for (const tag of fixture.expectedPresence.empty) {
    const escaped = escapedTag(tag);
    if (
      !new RegExp(`<${escaped}(?:\\s[^>]*)?>\\s*</${escaped}>|<${escaped}(?:\\s[^>]*)?\\s*/>`).test(
        text
      )
    ) {
      throw new Error(`Expected empty element <${tag}> is not empty: ${fixture.id}`);
    }
  }
  for (const [tag, value] of Object.entries(fixture.expectedValues ?? {})) {
    if (!text.includes(`<${tag}>${value}</${tag}>`)) {
      throw new Error(`Expected <${tag}> value ${value} is missing: ${fixture.id}`);
    }
  }
};

const verifyArtifact = async (artifact: Artifact, fixtures: Fixture[]) => {
  const cached = await readCachedBytes(artifact.cachePath);
  if (
    cached.bytes.byteLength !== artifact.zip.bytes ||
    sha256(cached.bytes) !== artifact.zip.sha256
  ) {
    throw new Error(`Cached ZIP does not match manifest: ${cached.path}`);
  }

  const process = Bun.spawn(["unzip", "-p", cached.path, artifact.xml.filename], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = new Response(process.stderr).text();
  const xmlHash = createHash("sha256");
  const decoder = new TextDecoder();
  const requestedByIndex = new Map(fixtures.map((fixture) => [fixture.recordIndex, fixture]));
  if (requestedByIndex.size !== fixtures.length) {
    throw new Error(`Duplicate fixture record index: ${artifact.id}`);
  }
  const found = new Set<string>();
  const actionOccurrences = new Map<string, number>();
  const actionRecordCounts = new Map<string, number>();
  const actionGroups: Artifact["xml"]["actionGroups"] = [];

  let pending = Buffer.alloc(0);
  let xmlBytes = 0;
  let recordIndex = 0;
  let recordBytes = 0;
  let maxRecordBytes = 0;
  let recordOpen = false;
  let actionRecordIndex = 0;
  let actionKey = "";
  let actionOccurrence = 0;
  let capture: Buffer[] | null = null;
  let capturedFixture: Fixture | null = null;
  let serialNumber = "";
  let rootName = "";
  let version = "";
  let versionDate = "";
  let creationDatetime = "";
  let transactionFrom = "";
  let transactionTo = "";
  let serialFrom = "";
  let serialTo = "";
  let previousSerial = "";
  let serialNumbersAscending = true;
  const uniqueSerialNumbers = new Set<string>();

  const readDocumentHeader = (text: string) => {
    rootName ||= text.match(rootLine)?.[1] ?? "";
    const nextActionKey = tagValue(text, "action-key");
    if (nextActionKey !== undefined) {
      actionKey = nextActionKey;
      actionOccurrence = (actionOccurrences.get(actionKey) ?? 0) + 1;
      actionOccurrences.set(actionKey, actionOccurrence);
      actionRecordIndex = 0;
      actionGroups.push({ actionKey, actionOccurrence, recordCount: 0 });
    }

    version ||= tagValue(text, "version-no") ?? "";
    versionDate ||= tagValue(text, "version-date") ?? "";
    creationDatetime ||= tagValue(text, "creation-datetime") ?? "";
  };

  const openRecord = (line: Buffer) => {
    recordIndex += 1;
    recordBytes = line.byteLength;
    recordOpen = true;
    actionRecordIndex += 1;
    actionRecordCounts.set(actionKey, (actionRecordCounts.get(actionKey) ?? 0) + 1);
    const currentActionGroup = actionGroups.at(-1);
    if (!currentActionGroup) {
      throw new Error(`Record outside action group: ${artifact.id}`);
    }
    currentActionGroup.recordCount += 1;
    capturedFixture = requestedByIndex.get(recordIndex) ?? null;
    capture = capturedFixture ? [line] : null;
    serialNumber = "";
  };

  const readRecordLine = (line: Buffer, text: string) => {
    if (recordOpen) {
      recordBytes += line.byteLength;
    }

    if (capture) {
      capture.push(line);
    }

    serialNumber ||= tagValue(text, "serial-number") ?? "";
    const transactionDate = tagValue(text, "transaction-date");
    if (transactionDate !== undefined) {
      transactionFrom =
        transactionFrom === "" || transactionDate < transactionFrom
          ? transactionDate
          : transactionFrom;
      transactionTo = transactionDate > transactionTo ? transactionDate : transactionTo;
    }
  };

  const verifyCapturedFixture = async () => {
    if (!(capturedFixture && capture)) {
      return;
    }
    if (
      capturedFixture.actionKey !== actionKey ||
      capturedFixture.actionOccurrence !== actionOccurrence ||
      capturedFixture.actionRecordIndex !== actionRecordIndex ||
      capturedFixture.serialNumber !== serialNumber
    ) {
      throw new Error(`Fixture selector drift: ${capturedFixture.id}`);
    }

    const excerpt = Buffer.concat(capture);
    verifyPresence(capturedFixture, excerpt);
    const excerptPath = join(repositoryRoot, capturedFixture.path);
    if (writeFixtures) {
      await mkdir(dirname(excerptPath), { recursive: true });
      await Bun.write(excerptPath, excerpt);
      capturedFixture.bytes = excerpt.byteLength;
      capturedFixture.sha256 = sha256(excerpt);
    } else {
      const committed = Bun.file(excerptPath);
      if (!(await committed.exists())) {
        throw new Error(`Missing committed fixture: ${excerptPath}`);
      }
      const committedBytes = new Uint8Array(await committed.arrayBuffer());
      if (
        committedBytes.byteLength !== capturedFixture.bytes ||
        sha256(committedBytes) !== capturedFixture.sha256 ||
        !committedBytes.every((byte, index) => byte === excerpt[index])
      ) {
        throw new Error(`Fixture is not the byte-exact source record: ${capturedFixture.id}`);
      }
    }

    found.add(capturedFixture.id);
    capture = null;
    capturedFixture = null;
  };

  const closeRecord = async () => {
    maxRecordBytes = Math.max(maxRecordBytes, recordBytes);
    recordOpen = false;
    serialFrom ||= serialNumber;
    serialTo = serialNumber;
    serialNumbersAscending &&= previousSerial === "" || serialNumber > previousSerial;
    previousSerial = serialNumber;
    uniqueSerialNumbers.add(serialNumber);
    await verifyCapturedFixture();
  };

  const consumeLine = async (line: Buffer) => {
    const text = decoder.decode(line);
    readDocumentHeader(text);
    if (caseFileOpenLine.test(text)) {
      openRecord(line);
      return;
    }
    readRecordLine(line, text);
    if (caseFileCloseLine.test(text)) {
      await closeRecord();
    }
  };

  for await (const chunk of process.stdout) {
    const bytes = Buffer.from(chunk);
    xmlHash.update(bytes);
    xmlBytes += bytes.byteLength;
    pending = concat(pending, bytes);
    let newline = pending.indexOf(10);
    while (newline !== -1) {
      const line = pending.subarray(0, newline + 1);
      pending = pending.subarray(newline + 1);
      // biome-ignore lint/performance/noAwaitInLoops: XML lines update one ordered scanner state.
      await consumeLine(line);
      newline = pending.indexOf(10);
    }
  }
  if (pending.byteLength > 0) {
    await consumeLine(pending);
  }

  const exitCode = await process.exited;
  const errorOutput = await stderr;
  if (exitCode !== 0) {
    throw new Error(`Unable to read ${artifact.zip.filename}: ${errorOutput.trim()}`);
  }

  const actualActionCounts = Object.fromEntries(
    [...actionRecordCounts].sort(([left], [right]) => left.localeCompare(right))
  );
  const expectedActionCounts = Object.fromEntries(
    Object.entries(artifact.xml.actionRecordCounts).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  const metadataMatches =
    xmlBytes === artifact.xml.bytes &&
    xmlHash.digest("hex") === artifact.xml.sha256 &&
    recordIndex === artifact.xml.recordCount &&
    maxRecordBytes === artifact.xml.maxRecordBytes &&
    JSON.stringify(actualActionCounts) === JSON.stringify(expectedActionCounts) &&
    JSON.stringify(actionGroups) === JSON.stringify(artifact.xml.actionGroups) &&
    transactionFrom === artifact.xml.transactionDateRange.from &&
    transactionTo === artifact.xml.transactionDateRange.to &&
    (artifact.xml.serialNumberRange === undefined ||
      (serialFrom === artifact.xml.serialNumberRange.from &&
        serialTo === artifact.xml.serialNumberRange.to)) &&
    (artifact.xml.uniqueSerialNumberCount === undefined ||
      uniqueSerialNumbers.size === artifact.xml.uniqueSerialNumberCount) &&
    (artifact.xml.serialNumberOrder === undefined || serialNumbersAscending) &&
    rootName === artifact.xml.root.name &&
    version === artifact.xml.root.version &&
    versionDate === artifact.xml.root.versionDate &&
    creationDatetime === artifact.xml.root.creationDatetime;
  if (!metadataMatches) {
    throw new Error(`Source XML metadata drift: ${artifact.id}`);
  }

  for (const fixture of fixtures) {
    if (!found.has(fixture.id)) {
      throw new Error(`Fixture record not found: ${fixture.id}`);
    }
  }
};

for (const evidence of manifest.retainedEvidence) {
  // biome-ignore lint/performance/noAwaitInLoops: Evidence verification is intentionally disk-serial.
  await verifyCachedEvidence(evidence);
}

for (const metadata of manifest.officialProductMetadata) {
  // biome-ignore lint/performance/noAwaitInLoops: Metadata verification is intentionally disk-serial.
  await verifyOfficialProductMetadata(metadata);
}

for (const artifact of manifest.artifacts) {
  // biome-ignore lint/performance/noAwaitInLoops: ZIP verification is intentionally memory- and disk-serial.
  await verifyArtifact(
    artifact,
    manifest.fixtures.filter((fixture) => fixture.artifactId === artifact.id)
  );
}

const recordDirectory = join(repositoryRoot, "fixtures/uspto/records");
const recordPaths = (await readdir(recordDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".xml"))
  .map((entry) => `fixtures/uspto/records/${entry.name}`);
assertFixturePathInventory(
  recordPaths,
  manifest.fixtures.map((fixture) => fixture.path)
);

if (writeFixtures) {
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(
  `Verified ${manifest.artifacts.length} retained USPTO ZIPs and ${manifest.fixtures.length} byte-exact record fixtures${writeFixtures ? " (fixtures regenerated)" : ""}.`
);
