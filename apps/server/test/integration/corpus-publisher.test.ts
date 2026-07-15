import { beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { createCorpusPublisher } from "../../src/ingestion/corpus-publisher.ts";
import { createSourceObservationModule } from "../../src/ingestion/source-observations.ts";
import { reconcileDiscoverySuccess, retainArtifactVersion } from "../../src/queries/artifact-repository.ts";
import {
  createCanonicalMarkRepository,
  publishCanonicalMarks,
} from "../../src/queries/canonical-mark-repository.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");

const database = postgres(databaseUrl, { max: 4, prepare: false });
const fixtureRoot = join(import.meta.dir, "../../../../fixtures/uspto/records");

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function recordsXml(records: Uint8Array[], creationDatetime: string) {
  return Buffer.concat([
    Buffer.from(
      `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>${creationDatetime}</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>TX</action-key>\n`,
    ),
    ...records,
    Buffer.from("</action-keys></file-segments></application-information></trademark-applications-daily>"),
  ]);
}

async function waitForAdvisoryWait(applicationName: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [waiting] = await database<Array<{ waiting: boolean }>>`
      select true as waiting from pg_stat_activity
      where application_name = ${applicationName} and wait_event_type = 'Lock' and wait_event = 'advisory'
      limit 1
    `;
    if (waiting?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${applicationName} did not wait on the advisory lock`);
}

type ArtifactInput = {
  artifactFilename: string;
  artifactId?: string;
  product: "TRTDXFAP" | "TRTYRAP";
  releaseDate: string;
  sourceFromDate: string;
  sourceToDate: string;
  xml: Buffer;
};

async function retainVerifiedArtifact(input: ArtifactInput) {
  const artifactId = input.artifactId ?? randomUUID();
  const artifactVersionId = randomUUID();
  const sha256 = createHash("sha256").update(input.xml).digest("hex");
  await database`insert into dataset_product (id) values (${input.product}) on conflict do nothing`;
  if (!input.artifactId) {
    await database`
      insert into artifact (id, product_id, filename) values (${artifactId}, ${input.product}, ${input.artifactFilename})
    `;
  }
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key)
    values (${artifactVersionId}, ${artifactId}, ${sha256}, ${input.xml.byteLength}, ${`fixtures/${sha256}`})
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${artifactId}, ${artifactVersionId}, ${sha256}, now(), 'verified',
      ${`https://api.uspto.gov/${input.artifactFilename}`}, ${input.xml.byteLength}, ${input.sourceFromDate},
      ${input.sourceToDate}, ${input.releaseDate}, now()
    )
  `;
  return { artifactId, artifactVersionId, sha256 };
}

async function retainAndStageArtifact(input: ArtifactInput) {
  const retained = await retainVerifiedArtifact(input);
  const parse = await createSourceObservationModule(database).stageArtifact({
    artifactVersionId: retained.artifactVersionId,
    xml: stream(input.xml),
  });
  return { ...retained, parse };
}

async function retainAndStageAnnual(filename: string, artifactFilename: string) {
  const record = await readFile(join(fixtureRoot, filename));
  const part = artifactFilename.match(/-(\d{2})\.zip$/)?.[1] ?? "00";
  return retainAndStageArtifact({
    artifactFilename,
    product: "TRTYRAP",
    releaseDate: "2026-04-03",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    xml: recordsXml([record], `20260403${part}49`),
  });
}

async function retainAnnualReissue(artifactId: string, artifactFilename: string) {
  const record = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  return retainAndStageArtifact({
    artifactFilename,
    artifactId,
    product: "TRTYRAP",
    releaseDate: "2026-07-15",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    xml: recordsXml([record], "202607150101"),
  });
}

async function retainAndStageEmptyAnnual(artifactFilename: string, artifactId?: string) {
  const part = artifactFilename.match(/-(\d{2})\.zip$/)?.[1] ?? "00";
  const reissue = artifactId ? "99" : part;
  const xml = Buffer.from(
    `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>20260403${reissue}00</creation-datetime><application-information><data-available-code>N</data-available-code></application-information></trademark-applications-daily>`,
  );
  return retainAndStageArtifact({
    artifactFilename,
    artifactId,
    product: "TRTYRAP",
    releaseDate: "2026-04-03",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    xml,
  });
}

async function retainStatusOnlyReissue(artifactId: string, artifactFilename: string) {
  const retained = await readFile(join(fixtureRoot, "annual-2025-status-only-tx-60000001.xml"));
  const record = Buffer.from(retained.toString("utf8").replaceAll("60000001", "60146682"));
  return retainAndStageArtifact({
    artifactFilename,
    artifactId,
    product: "TRTYRAP",
    releaseDate: "2026-07-15",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    xml: recordsXml([record], "202607151200"),
  });
}

async function retainAndStageDailyConflict(options: {
  artifactFilename?: string;
  replacement?: string;
} = {}) {
  const retained = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  const record = Buffer.from(retained.toString("utf8").replace(
    "<mark-identification>MACHINE-PISTOL</mark-identification>",
    options.replacement ?? "<mark-identification>COMPETING DAILY MARK</mark-identification>",
  ));
  const artifactFilename = options.artifactFilename ?? "apc260101.zip";
  return retainAndStageArtifact({
    artifactFilename,
    product: "TRTDXFAP",
    releaseDate: "2026-01-02",
    sourceFromDate: "2026-01-01",
    sourceToDate: "2026-01-01",
    xml: recordsXml([record], "202601020100"),
  });
}

async function retainAndStageDaily(date: string, artifactFilename: string) {
  const record = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  await retainAndStageArtifact({
    artifactFilename,
    product: "TRTDXFAP",
    releaseDate: date,
    sourceFromDate: date,
    sourceToDate: date,
    xml: recordsXml([record], `${date.replaceAll("-", "")}0100`),
  });
}

async function retainVerifiedDaily(date: string, artifactFilename: string) {
  const record = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  const xml = recordsXml([record], `${date.replaceAll("-", "")}0100`);
  const retained = await retainVerifiedArtifact({
    artifactFilename,
    product: "TRTDXFAP",
    releaseDate: date,
    sourceFromDate: date,
    sourceToDate: date,
    xml,
  });
  return { ...retained, xml };
}

async function retainDailyFixture(filename: string, artifactFilename: string, date: string) {
  const record = await readFile(join(fixtureRoot, filename));
  await retainAndStageArtifact({
    artifactFilename,
    product: "TRTDXFAP",
    releaseDate: date,
    sourceFromDate: date,
    sourceToDate: date,
    xml: recordsXml([record], `${date.replaceAll("-", "")}0100`),
  });
}

async function retainConflictingRegistrationPart() {
  const first = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  const second = Buffer.from(first.toString("utf8").replaceAll("60146682", "60146683"));
  await retainAndStageArtifact({
    artifactFilename: "apc18840407-20251231-01.zip",
    product: "TRTYRAP",
    releaseDate: "2026-04-03",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    xml: recordsXml([first, second], "202604030149"),
  });
}

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

test("requires every member of the pinned annual generation before staging publication", async () => {
  await retainAndStageAnnual("annual-2025-full-tx-60146682.xml", "apc18840407-20251231-01.zip");

  const result = await createCorpusPublisher(database).stage();

  expect(result).toEqual({
    missingAnnualArtifacts: 90,
    reason: "incomplete-annual-generation",
    status: "ineligible",
  });
});

test("stages the complete pinned annual generation without assigning member order", async () => {
  const filenames = Array.from(
    { length: 91 },
    (_, index) => `apc18840407-20251231-${String(index + 1).padStart(2, "0")}.zip`,
  ).reverse();
  for (const filename of filenames) {
    await retainAndStageAnnual("annual-2025-full-tx-60146682.xml", filename);
  }

  const result = await createCorpusPublisher(database).stage();

  expect(result).toEqual({
    artifactCount: 91,
    candidateId: expect.any(String),
    status: "staged",
  });
});

test("atomically publishes canonical state, frontier, corpus version, and one durable event", async () => {
  const filenames = Array.from(
    { length: 91 },
    (_, index) => `apc18840407-20251231-${String(index + 1).padStart(2, "0")}.zip`,
  );
  for (const filename of filenames) {
    await retainAndStageAnnual("annual-2025-full-tx-60146682.xml", filename);
  }
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected staged publication candidate");

  const published = await publisher.publish(candidate.candidateId);
  const replayed = await createCorpusPublisher(database).publish(candidate.candidateId);
  const mark = await createCanonicalMarkRepository(database).read("60146682");

  expect(published).toEqual({
    changed: true,
    completeThroughDate: "2025-12-31",
    corpusVersion: 1,
    eventId: expect.any(String),
    publishedThroughDate: "2025-12-31",
    status: "published",
  });
  expect(replayed).toEqual(published);
  expect(mark).toMatchObject({
    kind: "resolved",
    mark: {
      registrationNumber: "0146682",
      serialNumber: "60146682",
      wordMark: "MACHINE-PISTOL",
    },
  });
  expect(new Set(mark?.contributors.map((contributor) => contributor.artifactVersionSha256)).size).toBe(91);
});

test("persists unresolved diagnostics and rejects the whole candidate without canonical changes", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
  }
  await retainAndStageDailyConflict();
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected staged publication candidate");

  const rejected = await publisher.publish(candidate.candidateId);
  const replayed = await createCorpusPublisher(database).publish(candidate.candidateId);

  expect(rejected).toEqual({
    candidateId: candidate.candidateId,
    diagnosticCount: 1,
    status: "rejected",
  });
  expect(replayed).toEqual(rejected);
  const [diagnostic] = await database<Array<{ details: { claimPath: string; kind: string; serialNumber: string } }>>`
    select details from publication_diagnostic where publication_id = ${candidate.candidateId}
    order by diagnostic_key limit 1
  `;
  expect(diagnostic?.details).toMatchObject({
    claimPath: "case-file/case-file-header/mark-identification",
    kind: "authority-conflict",
    serialNumber: "60146682",
  });
  expect(await createCanonicalMarkRepository(database).read("60146682")).toBeNull();
});

test("requires an explicit retained version when one logical artifact is reissued", async () => {
  let firstPart: Awaited<ReturnType<typeof retainAndStageAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) firstPart = retained;
  }
  if (!firstPart) throw new Error("missing first annual part");
  const reissue = await retainAnnualReissue(firstPart.artifactId, "apc18840407-20251231-01.zip");
  const publisher = createCorpusPublisher(database);

  expect(await publisher.stage()).toMatchObject({
    artifacts: [{ filename: "apc18840407-20251231-01.zip", product: "TRTYRAP" }],
    reason: "reissue-selection-required",
    status: "ineligible",
  });
  expect(await publisher.stage({
    reissues: [{
      artifactVersionSha256: reissue.sha256,
      filename: "apc18840407-20251231-01.zip",
      product: "TRTYRAP",
    }],
  })).toMatchObject({ artifactCount: 91, status: "staged" });
});

test("revalidates automatic version eligibility after acquiring the publication lock", async () => {
  let firstPart: Awaited<ReturnType<typeof retainAndStageAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) firstPart = retained;
  }
  if (!firstPart) throw new Error("missing first annual part");
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected staged publication candidate");
  await retainAnnualReissue(firstPart.artifactId, "apc18840407-20251231-01.zip");

  await expect(publisher.publish(candidate.candidateId)).rejects.toThrow("Publication candidate eligibility changed");
  expect(await createCanonicalMarkRepository(database).read("60146682")).toBeNull();

  const explicitlySelected = await publisher.stage({
    reissues: [{
      artifactVersionSha256: firstPart.sha256,
      filename: "apc18840407-20251231-01.zip",
      product: "TRTYRAP",
    }],
  });
  if (explicitlySelected.status !== "staged") throw new Error("expected explicit candidate");
  expect(explicitlySelected.candidateId).not.toBe(candidate.candidateId);
  expect(await publisher.publish(explicitlySelected.candidateId)).toMatchObject({ status: "published" });
});

test("invalidates an explicit reissue selection when the retained version set changes", async () => {
  const firstPart = await retainAndStageAnnual(
    "annual-2025-full-tx-60146682.xml",
    "apc18840407-20251231-01.zip",
  );
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  await retainAnnualReissue(firstPart.artifactId, "apc18840407-20251231-01.zip");
  const publisher = createCorpusPublisher(database);
  const selected = await publisher.stage({
    reissues: [{
      artifactVersionSha256: firstPart.sha256,
      filename: "apc18840407-20251231-01.zip",
      product: "TRTYRAP",
    }],
  });
  if (selected.status !== "staged") throw new Error("expected explicit reissue candidate");

  await retainAndStageEmptyAnnual("apc18840407-20251231-01.zip", firstPart.artifactId);
  await expect(publisher.publish(selected.candidateId)).rejects.toThrow("Publication candidate eligibility changed");

  const restaged = await publisher.stage({
    reissues: [{
      artifactVersionSha256: firstPart.sha256,
      filename: "apc18840407-20251231-01.zip",
      product: "TRTYRAP",
    }],
  });
  if (restaged.status !== "staged") throw new Error("expected restaged explicit reissue candidate");
  expect(restaged.candidateId).not.toBe(selected.candidateId);
  expect(await publisher.publish(restaged.candidateId)).toMatchObject({ status: "published" });
});

test("rejects a reissue selection that matches no eligible logical artifact", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }

  await expect(createCorpusPublisher(database).stage({
    reissues: [{
      artifactVersionSha256: "a".repeat(64),
      filename: "apc18840407-20251231-92.zip",
      product: "TRTYRAP",
    }],
  })).rejects.toThrow("Selected reissue artifact is not eligible: TRTYRAP/apc18840407-20251231-92.zip");
});

test("revalidates the staged parse digest inside the publication transaction", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected digest candidate");
  await database`
    update parse_run set digest = ${"f".repeat(64)}
    where id = (select parse_run_id from publication_artifact where publication_id = ${candidate.candidateId} limit 1)
  `;

  await expect(publisher.publish(candidate.candidateId)).rejects.toThrow("Publication candidate eligibility changed");
});

test("rejects a candidate staged under older canonical semantic versions", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected semantic-version candidate");
  await database`
    update publication set authority_policy_version = 'uspto-authority-v0'
    where id = ${candidate.candidateId}
  `;

  await expect(publisher.publish(candidate.candidateId)).rejects.toThrow(
    "Publication candidate semantic versions changed",
  );
});

test("rejects a candidate when a verified daily becomes eligible after staging", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const daily = await retainVerifiedDaily("2026-01-01", "apc260101.zip");
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected candidate before daily parse completion");
  expect(candidate.artifactCount).toBe(91);

  expect(await createSourceObservationModule(database).stageArtifact({
    artifactVersionId: daily.artifactVersionId,
    xml: stream(daily.xml),
  })).toMatchObject({ status: "staged" });

  await expect(publisher.publish(candidate.candidateId)).rejects.toThrow(
    "Publication candidate complete eligible source set changed",
  );
});

test("serializes parse terminalization with complete candidate staging", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const daily = await retainVerifiedDaily("2026-01-01", "apc260101.zip");
  await database.unsafe(`
    create function block_prd63_parse_terminalization() returns trigger language plpgsql as $$
    begin
      perform pg_advisory_lock(hashtext('prd63-test-parse-terminalization'));
      perform pg_advisory_unlock(hashtext('prd63-test-parse-terminalization'));
      return new;
    end $$;
    create trigger block_prd63_parse_terminalization before update on parse_run
    for each row when (new.state = 'staged') execute function block_prd63_parse_terminalization();
  `);

  const blocker = await database.reserve();
  const parserDatabase = postgres(databaseUrl, {
    connection: { application_name: "prd63-parser" },
    max: 1,
    prepare: false,
  });
  const stagingDatabase = postgres(databaseUrl, {
    connection: { application_name: "prd63-stager" },
    max: 1,
    prepare: false,
  });
  let blockerLocked = false;
  let parse: ReturnType<ReturnType<typeof createSourceObservationModule>["stageArtifact"]> | null = null;
  let stage: ReturnType<ReturnType<typeof createCorpusPublisher>["stage"]> | null = null;
  let stageFinished = false;
  try {
    await blocker`select pg_advisory_lock(hashtext('prd63-test-parse-terminalization'))`;
    blockerLocked = true;
    parse = createSourceObservationModule(parserDatabase).stageArtifact({
      artifactVersionId: daily.artifactVersionId,
      xml: stream(daily.xml),
    });
    await waitForAdvisoryWait("prd63-parser");
    stage = createCorpusPublisher(stagingDatabase).stage().then((result) => {
      stageFinished = true;
      return result;
    });
    await waitForAdvisoryWait("prd63-stager");
    expect(stageFinished).toBe(false);
    await blocker`select pg_advisory_unlock(hashtext('prd63-test-parse-terminalization'))`;
    blockerLocked = false;
    expect(await parse).toMatchObject({ status: "staged" });
    const candidate = await stage;
    expect(candidate).toMatchObject({ artifactCount: 92, status: "staged" });
    if (candidate.status !== "staged") throw new Error("expected complete concurrent candidate");
    expect(await createCorpusPublisher(database).publish(candidate.candidateId)).toMatchObject({
      completeThroughDate: "2026-01-01",
      status: "published",
    });
  } finally {
    if (blockerLocked) await blocker`select pg_advisory_unlock(hashtext('prd63-test-parse-terminalization'))`;
    blocker.release();
    if (parse) await parse.catch(() => undefined);
    if (stage) await stage.catch(() => undefined);
    await parserDatabase.end({ timeout: 1 });
    await stagingDatabase.end({ timeout: 1 });
  }
});

test("revalidates the snapshotted discovery and coverage when the same bytes receive changed metadata", async () => {
  let firstPart: Awaited<ReturnType<typeof retainAndStageEmptyAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageEmptyAnnual(
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) firstPart = retained;
  }
  if (!firstPart) throw new Error("missing first annual part");
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected coverage candidate");
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) select ${randomUUID()}, artifact_id, id, ${"d".repeat(64)}, now() + interval '1 second', 'verified',
      'https://api.uspto.gov/repeated.zip', bytes, '1884-04-07', '2026-01-01', '2026-07-15', now()
    from artifact_version where id = ${firstPart.artifactVersionId}
  `;

  await expect(publisher.publish(candidate.candidateId)).rejects.toThrow(
    "Publication candidate complete eligible source set changed",
  );
});

test("advances only the contiguous complete frontier while publishing observations beyond a gap", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
  }
  const publisher = createCorpusPublisher(database);
  await retainAndStageDaily("2026-01-01", "apc260101.zip");
  const first = await publisher.stage();
  if (first.status !== "staged") throw new Error("expected first daily candidate");
  expect(await publisher.publish(first.candidateId)).toMatchObject({
    completeThroughDate: "2026-01-01",
    corpusVersion: 1,
    publishedThroughDate: "2026-01-01",
  });

  await retainAndStageDaily("2026-01-03", "apc260103.zip");
  const gapped = await publisher.stage();
  if (gapped.status !== "staged") throw new Error("expected gapped daily candidate");

  expect(await publisher.publish(gapped.candidateId)).toMatchObject({
    completeThroughDate: "2026-01-01",
    corpusVersion: 2,
    publishedThroughDate: "2026-01-03",
  });
});

test("rejects stale A after A plus B publishes and reuses the exact current publication", async () => {
  await retainAndStageAnnual("annual-2025-full-tx-60146682.xml", "apc18840407-20251231-01.zip");
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const publisher = createCorpusPublisher(database);
  const annualOnly = await publisher.stage();
  if (annualOnly.status !== "staged") throw new Error("expected annual-only candidate A");

  await retainAndStageDaily("2026-01-01", "apc260101.zip");
  const annualAndDaily = await publisher.stage();
  if (annualAndDaily.status !== "staged") throw new Error("expected A plus B candidate");
  const published = await publisher.publish(annualAndDaily.candidateId);
  if (published.status !== "published") throw new Error("expected A plus B publication");
  const markAfterNewer = await createCanonicalMarkRepository(database).read("60146682");
  const [stateAfterNewer] = await database<Array<{
    completeThroughDate: string;
    corpusVersion: number;
    publicationId: string;
    publishedThroughDate: string;
  }>>`
    select complete_through_date::text as "completeThroughDate", corpus_version as "corpusVersion",
      publication_id as "publicationId", published_through_date::text as "publishedThroughDate"
    from corpus_state where id = 'uspto'
  `;

  await expect(publisher.publish(annualOnly.candidateId)).rejects.toThrow("Publication candidate parent changed");
  expect(await createCanonicalMarkRepository(database).read("60146682")).toEqual(markAfterNewer);
  expect((await database<Array<{ completeThroughDate: string; corpusVersion: number; publicationId: string;
    publishedThroughDate: string }>>`
    select complete_through_date::text as "completeThroughDate", corpus_version as "corpusVersion",
      publication_id as "publicationId", published_through_date::text as "publishedThroughDate"
    from corpus_state where id = 'uspto'
  `)[0]).toEqual(stateAfterNewer);

  const restaged = await publisher.stage();
  expect(restaged).toEqual({
    artifactCount: 92,
    candidateId: annualAndDaily.candidateId,
    status: "published",
  });
  if (restaged.status !== "published") throw new Error("expected current publication replay");
  expect(await publisher.publish(restaged.candidateId)).toEqual(published);
});

test("blocks candidacy while the latest discovery for an eligible artifact is unresolved", async () => {
  let firstPart: Awaited<ReturnType<typeof retainAndStageEmptyAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageEmptyAnnual(
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) firstPart = retained;
  }
  if (!firstPart) throw new Error("missing unresolved discovery artifact");
  await database`
    insert into artifact_discovery (
      id, artifact_id, fingerprint, observed_at, download_state, download_url, expected_bytes,
      source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${firstPart.artifactId}, ${"a".repeat(64)}, now() + interval '1 second', 'pending',
      'https://api.uspto.gov/pending-reissue.zip', 1, '1884-04-07', '2025-12-31', '2026-07-16', now()
    )
  `;

  expect(await createCorpusPublisher(database).stage()).toEqual({
    artifacts: [{ filename: "apc18840407-20251231-01.zip", product: "TRTYRAP" }],
    reason: "unresolved-source-artifacts",
    status: "ineligible",
  });
});

test("rejects a staged candidate when a later discovery is unresolved before validation", async () => {
  let firstPart: Awaited<ReturnType<typeof retainAndStageEmptyAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageEmptyAnnual(
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) firstPart = retained;
  }
  if (!firstPart) throw new Error("missing pending publication artifact");
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected candidate before pending discovery");
  await database`
    insert into artifact_discovery (
      id, artifact_id, fingerprint, observed_at, download_state, download_url, expected_bytes,
      source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${firstPart.artifactId}, ${"b".repeat(64)}, now() + interval '1 second', 'downloading',
      'https://api.uspto.gov/downloading-reissue.zip', 1, '1884-04-07', '2025-12-31', '2026-07-16', now()
    )
  `;

  await expect(publisher.publish(candidate.candidateId)).rejects.toThrow(
    "Publication candidate source discovery is unresolved",
  );
});

test("does not delete a mark or group when an explicitly selected reissue omits it", async () => {
  const firstPart = await retainAndStageAnnual(
    "annual-2025-full-tx-60146682.xml",
    "apc18840407-20251231-01.zip",
  );
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const publisher = createCorpusPublisher(database);
  const initial = await publisher.stage();
  if (initial.status !== "staged") throw new Error("expected initial candidate");
  await publisher.publish(initial.candidateId);
  const before = await createCanonicalMarkRepository(database).read("60146682");

  const emptyReissue = await retainAndStageEmptyAnnual("apc18840407-20251231-01.zip", firstPart.artifactId);
  const omission = await publisher.stage({
    reissues: [{
      artifactVersionSha256: emptyReissue.sha256,
      filename: "apc18840407-20251231-01.zip",
      product: "TRTYRAP",
    }],
  });
  if (omission.status !== "staged") throw new Error("expected omission candidate");
  const published = await publisher.publish(omission.candidateId);

  expect(published).toMatchObject({ changed: false, corpusVersion: 1, status: "published" });
  expect(await createCorpusPublisher(database).publish(omission.candidateId)).toEqual(published);
  expect(await createCanonicalMarkRepository(database).read("60146682")).toEqual(before);
});

test("preserves unmentioned canonical groups when a reissue contains a status-only observation", async () => {
  const firstPart = await retainAndStageAnnual(
    "annual-2025-full-tx-60146682.xml",
    "apc18840407-20251231-01.zip",
  );
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const publisher = createCorpusPublisher(database);
  const initial = await publisher.stage();
  if (initial.status !== "staged") throw new Error("expected initial candidate");
  await publisher.publish(initial.candidateId);
  const before = await createCanonicalMarkRepository(database).read("60146682");
  if (!before) throw new Error("expected initial canonical mark");

  const reissue = await retainStatusOnlyReissue(firstPart.artifactId, "apc18840407-20251231-01.zip");
  const candidate = await publisher.stage({
    reissues: [{
      artifactVersionSha256: reissue.sha256,
      filename: "apc18840407-20251231-01.zip",
      product: "TRTYRAP",
    }],
  });
  if (candidate.status !== "staged") throw new Error("expected status-only candidate");
  await publisher.publish(candidate.candidateId);
  const after = await createCanonicalMarkRepository(database).read("60146682");

  expect(after).toMatchObject({
    classes: before.classes,
    goodsServices: before.goodsServices,
    mark: {
      filingDate: before.mark.filingDate,
      wordMark: before.mark.wordMark,
    },
    owners: before.owners,
  });
});

test("replaces complete collection rows and provenance when the collection shrinks", async () => {
  await retainAndStageAnnual("annual-2025-full-tx-60146682.xml", "apc18840407-20251231-01.zip");
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected collection candidate");
  await publisher.publish(candidate.candidateId);
  const base = await createCanonicalMarkRepository(database).read("60146682");
  if (!base) throw new Error("expected collection mark");
  const contributor = base.contributors.find((item) => item.group === "classes");
  if (!contributor) throw new Error("expected class contributor");
  const otherContributors = base.contributors.filter((item) => item.group !== "classes");
  const firstPath = "case-file/classifications/classification[1]";
  const removedPath = "case-file/classifications/classification[2]";

  await database.begin((transaction) => publishCanonicalMarks(transaction, [{
    ...base,
    classes: [...base.classes, { internationalCode: "999", statusCode: "A", statusDate: null }],
    contributors: [
      ...otherContributors,
      { ...contributor, claimPath: firstPath },
      { ...contributor, claimPath: removedPath, physicalRecordIndex: contributor.physicalRecordIndex + 1 },
    ],
  }]));
  await database.begin((transaction) => publishCanonicalMarks(transaction, [{
    ...base,
    contributors: [...otherContributors, { ...contributor, claimPath: firstPath }],
  }]));

  const replaced = await createCanonicalMarkRepository(database).read("60146682");
  expect(replaced?.classes).toEqual(base.classes);
  expect(replaced?.contributors.filter((item) => item.group === "classes")).toEqual([
    { ...contributor, claimPath: firstPath },
  ]);
  expect(replaced?.contributors.some((item) => item.claimPath === removedPath)).toBe(false);
});

test("keeps replay identity and work stable when alternating automatic and unnecessary sole-version selection", async () => {
  let soleAnnual: Awaited<ReturnType<typeof retainAndStageEmptyAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageEmptyAnnual(
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) soleAnnual = retained;
  }
  if (!soleAnnual) throw new Error("missing sole-version annual artifact");
  await retainDailyFixture("publication-before-79366581.xml", "apc240914.zip", "2024-09-14");
  await retainDailyFixture("publication-after-79366581.xml", "apc240925.zip", "2024-09-25");
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected publication transition candidate");
  const published = await publisher.publish(candidate.candidateId);
  if (published.status !== "published") throw new Error("expected published transition");
  const beforeReplay = await createCanonicalMarkRepository(database).read("79366581");
  if (!beforeReplay) throw new Error("expected daily canonical mark");

  const [beforeCounts] = await database<[{ events: number; publications: number }]>`
    select (select count(*)::int from corpus_event) as events,
      (select count(*)::int from publication) as publications
  `;
  let observationQueries = 0;
  const instrumented = postgres(databaseUrl, {
    debug(_connection, query) {
      if (query.includes("from publication_artifact publication_source")) observationQueries += 1;
    },
    max: 2,
    prepare: false,
  });
  try {
    const replayPublisher = createCorpusPublisher(instrumented);
    const replayCandidate = await replayPublisher.stage();
    expect(replayCandidate).toEqual({
      artifactCount: 93,
      candidateId: candidate.candidateId,
      status: "published",
    });
    if (replayCandidate.status !== "published") throw new Error("expected stable publication replay");
    expect(await replayPublisher.publish(replayCandidate.candidateId)).toEqual(published);
    const explicitCandidate = await replayPublisher.stage({
      reissues: [{
        artifactVersionSha256: soleAnnual.sha256,
        filename: "apc18840407-20251231-01.zip",
        product: "TRTYRAP",
      }],
    });
    expect(explicitCandidate).toEqual(replayCandidate);
    if (explicitCandidate.status !== "published") throw new Error("expected normalized sole-version replay");
    expect(await replayPublisher.publish(explicitCandidate.candidateId)).toEqual(published);
    expect(await replayPublisher.stage()).toEqual(replayCandidate);
    expect(observationQueries).toBe(0);
  } finally {
    await instrumented.end({ timeout: 1 });
  }
  const [afterCounts] = await database<[{ events: number; publications: number }]>`
    select (select count(*)::int from corpus_event) as events,
      (select count(*)::int from publication) as publications
  `;
  expect(afterCounts).toEqual(beforeCounts);
  expect(await createCanonicalMarkRepository(database).read("79366581")).toEqual(beforeReplay);
  expect(beforeReplay.statusEvents).toContainEqual(expect.objectContaining({ description: "PUBLISHED FOR OPPOSITION" }));
  expect(new Set(beforeReplay.statusEvents.map((event) => JSON.stringify(event))).size).toBe(beforeReplay.statusEvents.length);
  expect(new Set(beforeReplay.contributors.map((contributor) => JSON.stringify(contributor))).size)
    .toBe(beforeReplay.contributors.length);
});

test("persists unsupported semantics without mutating canonical state", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
  }
  await retainAndStageDailyConflict({
    artifactFilename: "apc260102.zip",
    replacement: "<mark-identification/>",
  });
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected unsupported candidate");

  expect(await publisher.publish(candidate.candidateId)).toEqual({
    candidateId: candidate.candidateId,
    diagnosticCount: 1,
    status: "rejected",
  });
  expect(await createCanonicalMarkRepository(database).read("60146682")).toBeNull();
});

test("rolls back every canonical and corpus write when a database invariant fails", async () => {
  await retainConflictingRegistrationPart();
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected rollback candidate");

  await expect(publisher.publish(candidate.candidateId)).rejects.toThrow("duplicate key value");
  expect(await createCanonicalMarkRepository(database).read("60146682")).toBeNull();
  expect(await createCanonicalMarkRepository(database).read("60146683")).toBeNull();
});

test("serializes concurrent duplicate publication and converges on one durable result", async () => {
  for (let index = 1; index <= 91; index += 1) {
    await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
  }
  const candidate = await createCorpusPublisher(database).stage();
  if (candidate.status !== "staged") throw new Error("expected concurrent candidate");
  const secondDatabase = postgres(databaseUrl, { max: 2, prepare: false });

  try {
    const results = await Promise.all([
      createCorpusPublisher(database).publish(candidate.candidateId),
      createCorpusPublisher(secondDatabase).publish(candidate.candidateId),
    ]);

    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toMatchObject({ corpusVersion: 1, status: "published" });
  } finally {
    await secondDatabase.end({ timeout: 1 });
  }
});

test("excludes artifact-version retention after publication eligibility validation", async () => {
  let firstPart: Awaited<ReturnType<typeof retainAndStageAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) firstPart = retained;
  }
  if (!firstPart) throw new Error("missing concurrent retention artifact");
  const candidate = await createCorpusPublisher(database).stage();
  if (candidate.status !== "staged") throw new Error("expected retention candidate");

  const discoveryId = randomUUID();
  const attemptId = randomUUID();
  const reissueBytes = Buffer.from("concurrent reissue");
  const reissueSha256 = createHash("sha256").update(reissueBytes).digest("hex");
  await database`insert into source_lane (id) values ('uspto-odp') on conflict do nothing`;
  await database`
    insert into artifact_discovery (
      id, artifact_id, fingerprint, observed_at, download_state, download_url, expected_bytes,
      source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${discoveryId}, ${firstPart.artifactId}, ${"e".repeat(64)}, now() + interval '1 second', 'verified',
      'https://api.uspto.gov/concurrent-reissue.zip', ${reissueBytes.byteLength}, '1884-04-07', '2025-12-31',
      '2026-07-15', now()
    )
  `;
  await database`
    insert into source_attempt (id, lane_id, kind, discovery_id, started_at)
    values (${attemptId}, 'uspto-odp', 'download', ${discoveryId}, now())
  `;
  await database.unsafe(`
    create function block_prd63_canonical_write() returns trigger language plpgsql as $$
    begin
      perform pg_advisory_lock(hashtext('prd63-test-canonical-write'));
      perform pg_advisory_unlock(hashtext('prd63-test-canonical-write'));
      return new;
    end $$;
    create trigger block_prd63_canonical_write before insert on mark
    for each statement execute function block_prd63_canonical_write();
  `);

  const blocker = await database.reserve();
  const publisherDatabase = postgres(databaseUrl, {
    connection: { application_name: "prd63-publisher" },
    max: 1,
    prepare: false,
  });
  const retentionPool = postgres(databaseUrl, {
    connection: { application_name: "prd63-retention" },
    max: 1,
    prepare: false,
  });
  const retentionDatabase = await retentionPool.reserve();
  let retentionFinished = false;
  let blockerLocked = false;
  let publication: ReturnType<ReturnType<typeof createCorpusPublisher>["publish"]> | null = null;
  let retention: Promise<boolean> | null = null;
  try {
    await blocker`select pg_advisory_lock(hashtext('prd63-test-canonical-write'))`;
    blockerLocked = true;
    publication = createCorpusPublisher(publisherDatabase).publish(candidate.candidateId);
    await waitForAdvisoryWait("prd63-publisher");
    retention = retainArtifactVersion(
      retentionDatabase,
      firstPart.artifactId,
      discoveryId,
      attemptId,
      { bytes: reissueBytes.byteLength, objectKey: `fixtures/${reissueSha256}`, sha256: reissueSha256 },
      { status: 200 },
      new Date(),
    ).then((created) => {
      retentionFinished = true;
      return created;
    });
    await waitForAdvisoryWait("prd63-retention");
    const [beforeRelease] = await database<[{ count: number }]>`
      select count(*)::int as count from artifact_version where artifact_id = ${firstPart.artifactId}
    `;
    expect(retentionFinished).toBe(false);
    expect(beforeRelease?.count).toBe(1);
    await blocker`select pg_advisory_unlock(hashtext('prd63-test-canonical-write'))`;
    blockerLocked = false;
    expect(await publication).toMatchObject({ corpusVersion: 1, status: "published" });
    expect(await retention).toBe(true);
    const [afterRelease] = await database<[{ count: number }]>`
      select count(*)::int as count from artifact_version where artifact_id = ${firstPart.artifactId}
    `;
    expect(afterRelease?.count).toBe(2);
  } finally {
    if (blockerLocked) await blocker`select pg_advisory_unlock(hashtext('prd63-test-canonical-write'))`;
    blocker.release();
    if (publication) await publication.catch(() => undefined);
    if (retention) await retention.catch(() => undefined);
    retentionDatabase.release();
    await publisherDatabase.end({ timeout: 1 });
    await retentionPool.end({ timeout: 1 });
  }
});

test("excludes changed discovery insertion after publication eligibility validation", async () => {
  let firstPart: Awaited<ReturnType<typeof retainAndStageAnnual>> | null = null;
  for (let index = 1; index <= 91; index += 1) {
    const retained = await retainAndStageAnnual(
      "annual-2025-full-tx-60146682.xml",
      `apc18840407-20251231-${String(index).padStart(2, "0")}.zip`,
    );
    if (index === 1) firstPart = retained;
  }
  if (!firstPart) throw new Error("missing concurrent discovery artifact");
  const candidate = await createCorpusPublisher(database).stage();
  if (candidate.status !== "staged") throw new Error("expected concurrent discovery candidate");
  const attemptId = randomUUID();
  await database`insert into source_lane (id) values ('uspto-odp') on conflict do nothing`;
  await database`
    insert into source_attempt (id, lane_id, kind, product_id, started_at)
    values (${attemptId}, 'uspto-odp', 'discovery', 'TRTYRAP', now())
  `;
  await database.unsafe(`
    create function block_prd63_discovery_publication() returns trigger language plpgsql as $$
    begin
      perform pg_advisory_lock(hashtext('prd63-test-discovery-publication'));
      perform pg_advisory_unlock(hashtext('prd63-test-discovery-publication'));
      return new;
    end $$;
    create trigger block_prd63_discovery_publication before insert on mark
    for each statement execute function block_prd63_discovery_publication();
  `);

  const blocker = await database.reserve();
  const publisherDatabase = postgres(databaseUrl, {
    connection: { application_name: "prd63-discovery-publisher" },
    max: 1,
    prepare: false,
  });
  const discoveryPool = postgres(databaseUrl, {
    connection: { application_name: "prd63-discovery-reconcile" },
    max: 1,
    prepare: false,
  });
  const discoveryDatabase = await discoveryPool.reserve();
  let blockerLocked = false;
  let discoveryFinished = false;
  let publication: ReturnType<ReturnType<typeof createCorpusPublisher>["publish"]> | null = null;
  let reconciliation: Promise<boolean> | null = null;
  try {
    await blocker`select pg_advisory_lock(hashtext('prd63-test-discovery-publication'))`;
    blockerLocked = true;
    publication = createCorpusPublisher(publisherDatabase).publish(candidate.candidateId);
    await waitForAdvisoryWait("prd63-discovery-publisher");
    const observedAt = new Date("2026-07-16T12:00:00Z");
    reconciliation = reconcileDiscoverySuccess(
      discoveryDatabase,
      {
        artifacts: [],
        product: {
          frequency: "Annual",
          identifier: "TRTYRAP",
          lastModifiedAt: observedAt.toISOString(),
          title: "Trademark Annual XML Files",
        },
        responseState: { status: 200 },
      },
      [{
        bytes: 1,
        downloadUrl: "https://api.uspto.gov/concurrent-discovery.zip",
        filename: "apc18840407-20251231-01.zip",
        fingerprint: "c".repeat(64),
        fromDate: "1884-04-07",
        lastModifiedAt: observedAt.toISOString(),
        releaseDate: "2026-07-16",
        toDate: "2025-12-31",
      }],
      attemptId,
      observedAt,
      new Date("2027-07-16T12:00:00Z"),
    ).then((changed) => {
      discoveryFinished = true;
      return changed;
    });
    await waitForAdvisoryWait("prd63-discovery-reconcile");
    const [beforeRelease] = await database<[{ count: number }]>`
      select count(*)::int as count from artifact_discovery where artifact_id = ${firstPart.artifactId}
    `;
    expect(discoveryFinished).toBe(false);
    expect(beforeRelease?.count).toBe(1);
    await blocker`select pg_advisory_unlock(hashtext('prd63-test-discovery-publication'))`;
    blockerLocked = false;
    expect(await publication).toMatchObject({ corpusVersion: 1, status: "published" });
    expect(await reconciliation).toBe(true);
    const [afterRelease] = await database<[{ count: number }]>`
      select count(*)::int as count from artifact_discovery where artifact_id = ${firstPart.artifactId}
    `;
    expect(afterRelease?.count).toBe(2);
    expect(await createCorpusPublisher(database).stage()).toMatchObject({
      reason: "unresolved-source-artifacts",
      status: "ineligible",
    });
  } finally {
    if (blockerLocked) await blocker`select pg_advisory_unlock(hashtext('prd63-test-discovery-publication'))`;
    blocker.release();
    if (publication) await publication.catch(() => undefined);
    if (reconciliation) await reconciliation.catch(() => undefined);
    discoveryDatabase.release();
    await publisherDatabase.end({ timeout: 1 });
    await discoveryPool.end({ timeout: 1 });
  }
});

test("commits and replays multi-batch rejection without returning durable diagnostics", async () => {
  const retained = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  const template = retained.toString("utf8");
  const annualRecords = Array.from({ length: 251 }, (_, index) => Buffer.from(template
    .replaceAll("60146682", String(62_000_000 + index))
    .replaceAll("0146682", String(2_000_000 + index))));
  const dailyRecords = annualRecords.map((record) => Buffer.from(record.toString("utf8").replace(
    "<mark-identification>MACHINE-PISTOL</mark-identification>",
    "<mark-identification>COMPETING DAILY MARK</mark-identification>",
  )));
  await retainAndStageArtifact({
    artifactFilename: "apc18840407-20251231-01.zip",
    product: "TRTYRAP",
    releaseDate: "2026-04-03",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    xml: recordsXml(annualRecords, "202604030149"),
  });
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  await retainAndStageArtifact({
    artifactFilename: "apc260101.zip",
    product: "TRTDXFAP",
    releaseDate: "2026-01-02",
    sourceFromDate: "2026-01-01",
    sourceToDate: "2026-01-01",
    xml: recordsXml(dailyRecords, "202601020100"),
  });
  const publisher = createCorpusPublisher(database);
  const candidate = await publisher.stage();
  if (candidate.status !== "staged") throw new Error("expected multi-batch diagnostic candidate");

  const rejected = await publisher.publish(candidate.candidateId);
  expect(rejected).toEqual({
    candidateId: candidate.candidateId,
    diagnosticCount: 251,
    status: "rejected",
  });
  expect(await publisher.publish(candidate.candidateId)).toEqual(rejected);
  const [diagnostics] = await database<[{ count: number }]>`
    select count(*)::int as count from publication_diagnostic where publication_id = ${candidate.candidateId}
  `;
  expect(diagnostics?.count).toBe(251);
});

test("folds observations across read pages before fixed-size set-oriented writes", async () => {
  const retained = await readFile(join(fixtureRoot, "annual-2025-full-tx-60146682.xml"));
  const template = retained.toString("utf8");
  const records = Array.from({ length: 501 }, (_, index) => Buffer.from(template
    .replaceAll("60146682", String(61_000_000 + index))
    .replaceAll("0146682", String(1_000_000 + index))));
  await retainAndStageArtifact({
    artifactFilename: "apc18840407-20251231-01.zip",
    product: "TRTYRAP",
    releaseDate: "2026-04-03",
    sourceFromDate: "1884-04-07",
    sourceToDate: "2025-12-31",
    xml: recordsXml(records, "202604030149"),
  });
  for (let index = 2; index <= 91; index += 1) {
    await retainAndStageEmptyAnnual(`apc18840407-20251231-${String(index).padStart(2, "0")}.zip`);
  }
  const candidate = await createCorpusPublisher(database).stage();
  if (candidate.status !== "staged") throw new Error("expected multi-serial candidate");
  let markWriteBatches = 0;
  let observationReadPages = 0;
  const instrumented = postgres(databaseUrl, {
    debug(_connection, query) {
      if (query.includes("jsonb_to_recordset") && query.includes("update mark set")) markWriteBatches += 1;
      if (query.includes("from publication_artifact publication_source")) observationReadPages += 1;
    },
    max: 2,
    prepare: false,
  });

  try {
    expect(await createCorpusPublisher(instrumented).publish(candidate.candidateId)).toMatchObject({
      corpusVersion: 1,
      status: "published",
    });
    const [count] = await database<[{ count: number }]>`select count(*)::int as count from mark`;
    expect(count?.count).toBe(501);
    expect(markWriteBatches).toBe(3);
    expect(observationReadPages).toBe(4);
  } finally {
    await instrumented.end({ timeout: 1 });
  }
});
