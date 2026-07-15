import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

import { migrateDatabase } from "../../src/db/migrate.ts";
import { createLocalArtifactStore } from "../../src/ingestion/local-artifact-store.ts";
import { createCanonicalMarkRepository } from "../../src/queries/canonical-mark-repository.ts";
import { materializeTracer } from "../../src/services/tracer-service.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");

const database = postgres(databaseUrl, { max: 2, prepare: false });
const temporaryDirectories: string[] = [];

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

test("retains and materializes the PRD-60 tracer idempotently through production modules", async () => {
  const artifactRoot = await mkdtemp(join(tmpdir(), "tmturtle-tracer-"));
  temporaryDirectories.push(artifactRoot);
  const artifactStore = createLocalArtifactStore(artifactRoot);

  const first = await materializeTracer({ artifactStore, database });
  const second = await materializeTracer({ artifactStore, database });

  expect(second).toEqual(first);
  expect(first).toMatchObject({
    registrationNumber: "0146682",
    serialNumber: "60146682",
    wordMark: "MACHINE-PISTOL",
  });
  expect(await createCanonicalMarkRepository(database).read("60146682")).toMatchObject({
    kind: "resolved",
    mark: {
      registrationNumber: "0146682",
      serialNumber: "60146682",
      wordMark: "MACHINE-PISTOL",
    },
  });
  const [counts] = await database<[{ artifacts: number; parseRuns: number; records: number; versions: number }]>`
    select
      (select count(*)::int from artifact) as artifacts,
      (select count(*)::int from artifact_version) as versions,
      (select count(*)::int from parse_run) as "parseRuns",
      (select count(*)::int from source_record) as records
  `;
  expect(counts).toEqual({ artifacts: 1, parseRuns: 1, records: 1, versions: 1 });
});

test("does not replace canonical state after corpus publication owns it", async () => {
  const artifactRoot = await mkdtemp(join(tmpdir(), "tmturtle-tracer-"));
  temporaryDirectories.push(artifactRoot);
  const artifactStore = createLocalArtifactStore(artifactRoot);
  await materializeTracer({ artifactStore, database });

  const repository = createCanonicalMarkRepository(database);
  const materialization = await repository.read("60146682");
  if (!materialization) throw new Error("Tracer mark was not materialized");
  await repository.replace({
    ...materialization,
    mark: { ...materialization.mark, wordMark: "CORPUS-PUBLISHED" },
  });

  const publicationId = randomUUID();
  await database`
    insert into publication (
      id, fingerprint, source_fingerprint, parser_version, authority_policy_version,
      projection_version, normalization_version, source_profile_version, state,
      artifact_count, corpus_version, published_at
    ) values (
      ${publicationId}, ${"a".repeat(64)}, ${"b".repeat(64)}, 'parser', 'authority',
      'projection', 'normalization', 'profile', 'published', 1, 1, now()
    )
  `;
  await database`
    insert into corpus_state (id, corpus_version, publication_id)
    values ('uspto', 1, ${publicationId})
  `;

  await materializeTracer({ artifactStore, database });

  expect(await repository.read("60146682")).toMatchObject({
    mark: { wordMark: "CORPUS-PUBLISHED" },
  });
});
