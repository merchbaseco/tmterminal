import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { canonicalizeMark } from "../../src/ingestion/canonical-marks.ts";
import { createSourceObservationModule } from "../../src/ingestion/source-observations.ts";
import { createCanonicalMarkRepository } from "../../src/queries/canonical-mark-repository.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

const database = postgres(databaseUrl, { max: 2, prepare: false });
let server: Awaited<ReturnType<typeof buildServer>>;

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

beforeAll(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);

  const retained = await readFile(
    join(import.meta.dir, "../../../../fixtures/uspto/records/annual-2025-full-tx-60146682.xml")
  );
  const record = Buffer.from(
    retained
      .toString("utf8")
      .replace("<primary-code>009</primary-code>", "<primary-code>025</primary-code>")
      .replace(
        "<international-code>009</international-code>",
        "<international-code>025</international-code>"
      )
  );
  const xml = Buffer.concat([
    Buffer.from(
      "<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>TX</action-key>\n"
    ),
    record,
    Buffer.from(
      "</action-keys></file-segments></application-information></trademark-applications-daily>"
    ),
  ]);
  const artifactId = randomUUID();
  const artifactVersionId = randomUUID();
  const sha256 = createHash("sha256").update(xml).digest("hex");
  await database`insert into dataset_product (id) values ('TRTYRAP')`;
  await database`insert into artifact (id, product_id, filename) values (${artifactId}, 'TRTYRAP', 'apc18840407-20251231-01.zip')`;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key)
    values (${artifactVersionId}, ${artifactId}, ${sha256}, ${xml.byteLength}, ${`fixtures/${sha256}`})
  `;
  const observations = createSourceObservationModule(database);
  const parse = await observations.stageArtifact({ artifactVersionId, xml: stream(xml) });
  const materialization = canonicalizeMark(
    await Array.fromAsync(observations.readRecords(parse.parseRunId))
  );
  if (materialization.kind !== "resolved") {
    throw new Error("Expected the PRD-60 fixture to resolve");
  }
  await createCanonicalMarkRepository(database).replace(materialization);

  server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => (token === "clerk-session" ? "user_prd60" : null),
  });
});

afterAll(async () => {
  await server.close();
  await database.end({ timeout: 1 });
});

test("returns the retained canonical mark by exact serial number to a Clerk session", async () => {
  const response = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: "/api/trpc/marks.get?input=%7B%22serialNumber%22%3A%2260146682%22%7D",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().result.data).toMatchObject({
    classes: [{ internationalCode: "025", statusCode: "6", statusDate: "2010-04-08" }],
    goodsServices: [{ text: "pistols", typeCode: "GS0091" }],
    legalDisclaimer:
      "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.",
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
      contributors: expect.arrayContaining([
        expect.objectContaining({
          group: "mark-presentation",
          physicalRecordIndex: 1,
          product: "TRTYRAP",
        }),
      ]),
      versions: {
        authorityPolicy: "uspto-authority-v1",
        normalization: "uspto-normalization-v1",
        projection: "uspto-projection-v1",
        sourceProfile: "uspto-application-xml-v2.0-v1",
      },
    },
  });
});

test("preserves the leading zero in exact registration-number identity", async () => {
  const exact = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: "/api/trpc/marks.get-by-registration?input=%7B%22registrationNumber%22%3A%220146682%22%7D",
  });
  const missingZero = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: "/api/trpc/marks.get-by-registration?input=%7B%22registrationNumber%22%3A%22146682%22%7D",
  });

  expect(exact.statusCode).toBe(200);
  expect(exact.json().result.data.mark).toMatchObject({
    registrationNumber: "0146682",
    serialNumber: "60146682",
    wordMark: "MACHINE-PISTOL",
  });
  expect(missingZero.statusCode).toBe(400);
  expect(missingZero.json().error.data.code).toBe("BAD_REQUEST");
});

test("returns the same known mark through Clerk and API-key credentials", async () => {
  const created = await server.inject({
    headers: { authorization: "Bearer clerk-session", "content-type": "application/json" },
    method: "POST",
    payload: { name: "PRD-60 parity" },
    url: "/api/trpc/account.api-keys.create",
  });
  const token = created.json().result.data.token as string;
  const clerk = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: "/api/trpc/marks.get?input=%7B%22serialNumber%22%3A%2260146682%22%7D",
  });
  const apiKey = await server.inject({
    headers: { authorization: `Bearer ${token}` },
    method: "GET",
    url: "/api/trpc/marks.get?input=%7B%22serialNumber%22%3A%2260146682%22%7D",
  });

  expect(apiKey.statusCode).toBe(200);
  expect(apiKey.json().result.data).toEqual(clerk.json().result.data);
});

test("returns one stable not-found error for exact identities", async () => {
  const bySerial = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: "/api/trpc/marks.get?input=%7B%22serialNumber%22%3A%2299999999%22%7D",
  });
  const byRegistration = await server.inject({
    headers: { authorization: "Bearer clerk-session" },
    method: "GET",
    url: "/api/trpc/marks.get-by-registration?input=%7B%22registrationNumber%22%3A%229999999%22%7D",
  });

  expect(bySerial.statusCode).toBe(404);
  expect(byRegistration.statusCode).toBe(404);
  expect(bySerial.json().error).toMatchObject({
    data: { code: "NOT_FOUND" },
    message: "Trademark not found",
  });
  expect(byRegistration.json().error).toMatchObject({
    data: { code: "NOT_FOUND" },
    message: "Trademark not found",
  });
});
