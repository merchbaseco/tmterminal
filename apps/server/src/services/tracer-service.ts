import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

import type { ArtifactStore } from "../ingestion/artifact-store.ts";
import { canonicalizeMark } from "../ingestion/canonical-marks.ts";
import { createSourceObservationModule } from "../ingestion/source-observations.ts";
import { replaceTracerCanonicalMark, retainTracerArtifactVersion } from "../queries/tracer-repository.ts";

const fixtureId = "annual-2025-full-tx";
const expectedMark = {
  registrationNumber: "0146682",
  serialNumber: "60146682",
  wordMark: "MACHINE-PISTOL",
} as const;
const defaultFixtureRoot = fileURLToPath(new URL("../../../../fixtures/uspto", import.meta.url));

type Fixture = {
  actionKey: string;
  bytes: number;
  id: string;
  path: string;
  serialNumber: string;
  sha256: string;
};

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function tracerXml(record: Uint8Array, fixture: Fixture) {
  return Buffer.concat([
    Buffer.from(
      `<trademark-applications-daily><version><version-no>2.0</version-no><version-date>20041108</version-date></version><creation-datetime>202604031349</creation-datetime><application-information><file-segments><file-segment>TRMK</file-segment><action-keys><action-key>${fixture.actionKey}</action-key>\n`,
    ),
    record,
    Buffer.from("</action-keys></file-segments></application-information></trademark-applications-daily>"),
  ]);
}

export async function materializeTracer(options: {
  artifactStore: ArtifactStore;
  database: postgres.Sql;
}) {
  const manifest = await Bun.file(join(defaultFixtureRoot, "manifest.json")).json() as { fixtures?: Fixture[] };
  const fixture = manifest.fixtures?.find((candidate) => candidate.id === fixtureId);
  if (!fixture) throw new Error(`Missing retained fixture ${fixtureId}`);
  if (fixture.serialNumber !== expectedMark.serialNumber) throw new Error("Tracer fixture identity drifted");

  const recordPath = join(defaultFixtureRoot, fixture.path.replace(/^fixtures\/uspto\//, ""));
  const record = new Uint8Array(await Bun.file(recordPath).arrayBuffer());
  const recordSha256 = createHash("sha256").update(record).digest("hex");
  if (record.byteLength !== fixture.bytes || recordSha256 !== fixture.sha256) {
    throw new Error("Tracer fixture bytes do not match the retained manifest");
  }

  const xml = tracerXml(record, fixture);
  const stored = await options.artifactStore.put(stream(xml), xml.byteLength);
  const artifactVersionId = await retainTracerArtifactVersion(options.database, stored);
  const observations = createSourceObservationModule(options.database);
  const parse = await observations.stageArtifact({
    artifactVersionId,
    xml: await options.artifactStore.get(stored.objectKey),
  });
  if (parse.status !== "staged" || parse.recordCount !== 1 || parse.rejectCount !== 0) {
    throw new Error("Tracer fixture did not stage exactly one source observation");
  }
  const records = await Array.fromAsync(observations.readRecords(parse.parseRunId));
  if (records[0]?.digest !== fixture.sha256) throw new Error("Tracer source observation digest drifted");

  const materialization = canonicalizeMark(records);
  if (materialization.kind !== "resolved") throw new Error("Tracer canonicalization is unresolved");
  if (
    materialization.mark.serialNumber !== expectedMark.serialNumber ||
    materialization.mark.registrationNumber !== expectedMark.registrationNumber ||
    materialization.mark.wordMark !== expectedMark.wordMark
  ) {
    throw new Error("Tracer canonical mark identity drifted");
  }
  await replaceTracerCanonicalMark(options.database, materialization);
  return { ...expectedMark, artifactVersionSha256: stored.sha256 };
}
