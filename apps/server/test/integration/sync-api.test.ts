import { afterAll, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import { buildServer } from "../../src/api/server.ts";
import { migrateDatabase, migrateSchedulerDatabase } from "../../src/db/migrate.ts";
import { createIngestionScheduler } from "../../src/ingestion/ingestion-scheduler.ts";
import { retainedVersionFingerprint } from "../../src/ingestion/artifact-version-selection.ts";
import { createOperatorSyncService } from "../../src/services/operator-sync-service.ts";
import { createSyncService } from "../../src/services/sync-service.ts";
import { resetTestDatabase } from "./test-database.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");

const database = postgres(databaseUrl, { max: 2, prepare: false });

beforeEach(async () => {
  await resetTestDatabase(database);
  await migrateDatabase(databaseUrl);
  await migrateSchedulerDatabase(databaseUrl);
});

afterAll(async () => {
  await database.end({ timeout: 1 });
});

async function waitForReconcileState(state: "active" | "failed") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [job] = await database<Array<{ count: number }>>`
      select count(*)::int as count from pgboss.job
      where name = 'ingestion-reconcile' and state = ${state}
    `;
    if ((job?.count ?? 0) > 0) return;
    await Bun.sleep(25);
  }
  throw new Error(`reconciliation did not become ${state}`);
}

test("sync.status reports the complete frontier and persisted degraded state", async () => {
  const [{ completeThroughDate, publishedThroughDate }] = await database<[
    { completeThroughDate: string; publishedThroughDate: string },
  ]>`
    select
      (current_date - 2)::text as "completeThroughDate",
      current_date::text as "publishedThroughDate"
  `;
  const artifactId = randomUUID();
  const versionId = randomUUID();
  const parseRunId = randomUUID();
  const attemptId = randomUUID();

  await database`insert into dataset_product (id) values ('TRTDXFAP'), ('TRTYRAP')`;
  await database`
    insert into source_lane (
      id, status, transient_failure_count, stop_reason, updated_at
    ) values (
      'uspto-odp', 'stopped', 0, 'HTTP_403', '2026-07-14T14:00:00Z'
    )
  `;
  await database`
    insert into source_attempt (
      id, lane_id, kind, product_id, started_at, finished_at, outcome, error_code
    ) values (
      ${attemptId}, 'uspto-odp', 'discovery', 'TRTDXFAP',
      '2026-07-14T13:59:00Z', '2026-07-14T14:00:00Z', 'credential_failure', 'HTTP_403'
    )
  `;
  await database`
    insert into source_alert (id, lane_id, attempt_id, kind, message, created_at)
    values (${randomUUID()}, 'uspto-odp', ${attemptId}, 'credential', 'USPTO credential rejected', '2026-07-14T14:00:00Z')
  `;
  await database`
    insert into artifact (id, product_id, filename)
    values (${artifactId}, 'TRTDXFAP', 'apc260714.zip')
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${artifactId}, ${"a".repeat(64)}, '2026-07-14T13:00:00Z', 'pending',
      'https://api.uspto.gov/apc260714.zip', 100, '2026-07-14', '2026-07-14', '2026-07-15',
      '2026-07-15T12:00:00Z'
    )
  `;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
    values (${versionId}, ${artifactId}, ${"b".repeat(64)}, 100, ${`sha256/bb/${"b".repeat(64)}`}, 'quarantined')
  `;
  await database`
    update artifact_discovery
    set download_state = 'verified', artifact_version_id = ${versionId}
    where artifact_id = ${artifactId}
  `;
  await database`
    insert into parse_run (
      id, artifact_version_id, state, parser_version, digest, record_count, reject_count,
      started_at, finished_at
    ) values (
      ${parseRunId}, ${versionId}, 'quarantined', 'uspto-application-xml-v2', ${"c".repeat(64)}, 0, 1,
      '2026-07-14T13:30:00Z', '2026-07-14T13:31:00Z'
    )
  `;
  await database`
    insert into parse_reject (
      id, parse_run_id, physical_record_index, reason, raw_xml, bytes, digest, created_at
    ) values (
      ${randomUUID()}, ${parseRunId}, 12, 'malformed or truncated XML', ${Buffer.from("<case-file>")},
      11, ${"d".repeat(64)}, '2026-07-14T13:31:00Z'
    )
  `;
  await database`
    insert into corpus_state (
      id, published_through_date, complete_through_date, last_successful_merge_at, corpus_version
    ) values (
      'uspto', ${publishedThroughDate}, ${completeThroughDate}, '2026-07-14T12:00:00Z', 7
    )
  `;

  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "user-session" ? "user_sync_status" : null,
  });

  try {
    const response = await server.inject({
      method: "GET",
      url: "/api/trpc/sync.status",
      headers: { authorization: "Bearer user-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toEqual({
      activeState: "stopped",
      completeThroughDate,
      corpusVersion: 7,
      degraded: true,
      degradedSince: "2026-07-14T12:00:00.000Z",
      failedCount: 1,
      lastSuccessfulMergeAt: "2026-07-14T12:00:00.000Z",
      pendingCount: 0,
      publishedThroughDate,
      quarantineCount: 1,
      rejectCount: 1,
      reissueSelectionRequiredCount: 0,
      stale: false,
      staleSince: null,
    });
  } finally {
    await server.close();
  }
});

test("resolved source alerts remain auditable without degrading current status", async () => {
  const attemptId = randomUUID();
  await database`insert into dataset_product (id) values ('TRTDXFAP')`;
  await database`insert into source_lane (id, status) values ('uspto-odp', 'ready')`;
  await database`
    insert into source_attempt (id, lane_id, kind, product_id, started_at, finished_at, outcome, error_code)
    values (
      ${attemptId}, 'uspto-odp', 'discovery', 'TRTDXFAP', '2026-07-14T10:00:00Z',
      '2026-07-14T10:01:00Z', 'credential_failure', 'HTTP_403'
    )
  `;
  await database`
    insert into source_alert (
      id, lane_id, attempt_id, kind, message, created_at, resolved_at, resolution_reason
    ) values (
      ${randomUUID()}, 'uspto-odp', ${attemptId}, 'credential', 'USPTO credential rejected',
      '2026-07-14T10:01:00Z', '2026-07-14T11:00:00Z', 'credential replaced and lane inspected'
    )
  `;
  await database`
    insert into corpus_state (
      id, published_through_date, complete_through_date, last_successful_merge_at, corpus_version
    ) values ('uspto', current_date, current_date, now(), 1)
  `;
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "user-session" ? "user_resolved_alert" : null,
  });

  try {
    const response = await server.inject({
      method: "GET",
      url: "/api/trpc/sync.status",
      headers: { authorization: "Bearer user-session" },
    });
    expect(response.json().result.data).toMatchObject({
      degraded: false,
      degradedSince: null,
      failedCount: 0,
    });
    const [history] = await database<Array<{ reason: string; resolvedAt: Date }>>`
      select resolution_reason as reason, resolved_at as "resolvedAt" from source_alert
    `;
    expect(history?.reason).toBe("credential replaced and lane inspected");
    expect(history?.resolvedAt).toBeInstanceOf(Date);
  } finally {
    await server.close();
  }
});

test("outstanding source alerts supply degradedSince", async () => {
  const attemptId = randomUUID();
  await database`insert into dataset_product (id) values ('TRTDXFAP')`;
  await database`insert into source_lane (id, status) values ('uspto-odp', 'ready')`;
  await database`
    insert into source_attempt (id, lane_id, kind, product_id, started_at, finished_at, outcome)
    values (${attemptId}, 'uspto-odp', 'discovery', 'TRTDXFAP', '2026-07-14T10:00:00Z', '2026-07-14T10:01:00Z', 'permanent_failure')
  `;
  await database`
    insert into source_alert (id, lane_id, attempt_id, kind, message, created_at)
    values (${randomUUID()}, 'uspto-odp', ${attemptId}, 'permanent', 'source contract rejected', '2026-07-14T10:01:00Z')
  `;
  await database`
    insert into corpus_state (
      id, published_through_date, complete_through_date, last_successful_merge_at, corpus_version
    ) values ('uspto', current_date, current_date, now(), 1)
  `;
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "user-session" ? "user_alert_since" : null,
  });
  try {
    const response = await server.inject({
      method: "GET",
      url: "/api/trpc/sync.status",
      headers: { authorization: "Bearer user-session" },
    });
    expect(response.json().result.data).toMatchObject({
      degraded: true,
      degradedSince: "2026-07-14T10:01:00.000Z",
      failedCount: 1,
    });
  } finally {
    await server.close();
  }
});

test("pendingCount counts distinct logical artifacts with outstanding work", async () => {
  await database`insert into dataset_product (id) values ('TRTDXFAP')`;
  for (const state of ["pending-and-verified", "two-verified", "published"] as const) {
    const artifactId = randomUUID();
    await database`
      insert into artifact (id, product_id, filename)
      values (${artifactId}, 'TRTDXFAP', ${`${state}.zip`})
    `;
    const versionCount = state === "two-verified" ? 2 : 1;
    for (let index = 0; index < versionCount; index += 1) {
      const versionId = randomUUID();
      await database`
        insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
        values (
          ${versionId}, ${artifactId}, ${randomUUID().replaceAll("-", "").padEnd(64, "0")}, 1,
          ${`fixture/${versionId}`}, ${state === "published" ? "published" : "verified"}
        )
      `;
      if (index === 0) {
        await database`
          insert into artifact_discovery (
            id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
            expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
          ) values (
            ${randomUUID()}, ${artifactId}, ${versionId}, ${randomUUID().replaceAll("-", "").padEnd(64, "0")},
            now(), ${state === "pending-and-verified" ? "pending" : "verified"}, 'https://example.test/source.zip',
            1, current_date, current_date, current_date, now()
          )
        `;
      }
    }
  }
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "user-session" ? "user_pending_count" : null,
  });
  try {
    const response = await server.inject({
      method: "GET",
      url: "/api/trpc/sync.status",
      headers: { authorization: "Bearer user-session" },
    });
    expect(response.json().result.data.pendingCount).toBe(2);
  } finally {
    await server.close();
  }
});

test("private sync procedures require a Clerk session with the database operator role", async () => {
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => {
      if (token === "operator-session") return "user_operator";
      if (token === "customer-session") return "user_customer";
      return null;
    },
  });

  try {
    const account = await server.inject({
      method: "GET",
      url: "/api/trpc/account.me",
      headers: { authorization: "Bearer operator-session" },
    });
    const accountId = account.json().result.data.accountId as string;
    await database`
      insert into role_assignment (account_id, role)
      values (${accountId}, 'operator')
    `;

    const operator = await server.inject({
      method: "GET",
      url: "/api/trpc/ops.sync.status",
      headers: { authorization: "Bearer operator-session" },
    });
    const customer = await server.inject({
      method: "GET",
      url: "/api/trpc/ops.sync.status",
      headers: { authorization: "Bearer customer-session" },
    });
    const createdKey = await server.inject({
      method: "POST",
      url: "/api/trpc/account.api-keys.create",
      headers: {
        authorization: "Bearer operator-session",
        "content-type": "application/json",
      },
      payload: { name: "operator account key" },
    });
    const apiKey = await server.inject({
      method: "GET",
      url: "/api/trpc/ops.sync.status",
      headers: { authorization: `Bearer ${createdKey.json().result.data.token}` },
    });

    expect(operator.statusCode).toBe(200);
    expect(operator.json().result.data).toMatchObject({
      datasets: [
        expect.objectContaining({ product: "TRTYRAP" }),
        expect.objectContaining({ product: "TRTDXFAP" }),
      ],
      summary: {
        activeState: "idle",
        corpusVersion: 0,
        degraded: true,
      },
    });
    expect(customer.statusCode).toBe(403);
    expect(customer.json().error.data.code).toBe("FORBIDDEN");
    expect(apiKey.statusCode).toBe(403);
    expect(apiKey.json().error.data.code).toBe("FORBIDDEN");
  } finally {
    await server.close();
  }
});

test("a failed parse target degrades only its dataset", async () => {
  const artifactId = randomUUID();
  const versionId = randomUUID();
  await database`insert into dataset_product (id) values ('TRTDXFAP'), ('TRTYRAP')`;
  await database`insert into source_lane (id, status) values ('uspto-odp', 'ready')`;
  await database`
    insert into artifact (id, product_id, filename)
    values (${artifactId}, 'TRTDXFAP', 'apc260715.zip')
  `;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
    values (${versionId}, ${artifactId}, ${"a".repeat(64)}, 100, 'missing/apc260715.zip', 'verified')
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${artifactId}, ${versionId}, ${"b".repeat(64)}, now(), 'verified',
      'https://example.test/apc260715.zip', 100, '2026-07-15', '2026-07-15', '2026-07-15', now()
    )
  `;
  await database`
    insert into corpus_state (
      id, published_through_date, complete_through_date, last_successful_merge_at, corpus_version
    ) values ('uspto', current_date, current_date, now(), 1)
  `;

  const scheduler = createIngestionScheduler({
    databaseUrl,
    pollMs: 60_000,
    reconcile: async () => { throw new Error("retained bytes missing at https://secret.example/token"); },
  });
  await scheduler.start();
  await scheduler.waitForFirstReconciliation();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [failed] = await database<Array<{ count: number }>>`
      select count(*)::int as count from pgboss.job
      where name = 'ingestion-reconcile' and state = 'failed'
    `;
    if (failed?.count === 1) break;
    await Bun.sleep(25);
  }

  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "operator-session" ? "user_dataset_failure_operator" : null,
  });
  try {
    const account = await server.inject({
      method: "GET",
      url: "/api/trpc/account.me",
      headers: { authorization: "Bearer operator-session" },
    });
    await database`
      insert into role_assignment (account_id, role)
      values (${account.json().result.data.accountId}, 'operator')
    `;
    const response = await server.inject({
      method: "GET",
      url: "/api/trpc/ops.sync.status",
      headers: { authorization: "Bearer operator-session" },
    });
    const datasets = response.json().result.data.datasets as Array<Record<string, unknown>>;
    expect(datasets.find((dataset) => dataset.product === "TRTDXFAP")).toMatchObject({
      currentStage: "failed",
      failedCount: 1,
      reason: "retained bytes missing at [url]",
    });
    expect(datasets.find((dataset) => dataset.product === "TRTYRAP")).toMatchObject({
      currentStage: "idle",
      failedCount: 0,
      reason: null,
    });
  } finally {
    await server.close();
    await scheduler.stop();
  }
});

test("a stopped lane keeps its reason while an older staged candidate is actively recovered", async () => {
  const artifactId = randomUUID();
  const versionId = randomUUID();
  const discoveryId = randomUUID();
  const parseRunId = randomUUID();
  const parentId = randomUUID();
  const candidateId = randomUUID();
  await database`insert into dataset_product (id) values ('TRTDXFAP'), ('TRTYRAP')`;
  await database`
    insert into source_lane (id, status, stop_reason, updated_at)
    values ('uspto-odp', 'stopped', 'USPTO credential rejected', '2026-07-15T11:00:00Z')
  `;
  await database`insert into artifact (id, product_id, filename) values (${artifactId}, 'TRTDXFAP', 'apc260715.zip')`;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
    values (${versionId}, ${artifactId}, ${"a".repeat(64)}, 100, 'fixture/apc260715.zip', 'staged')
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${discoveryId}, ${artifactId}, ${versionId}, ${"b".repeat(64)}, '2026-07-15T10:00:00Z', 'verified',
      'https://example.test/apc260715.zip', 100, '2026-07-15', '2026-07-15', '2026-07-15', '2026-07-15T10:00:00Z'
    )
  `;
  await database`
    insert into parse_run (id, artifact_version_id, state, parser_version, digest, started_at, finished_at)
    values (${parseRunId}, ${versionId}, 'staged', 'uspto-application-xml-v2', ${"c".repeat(64)}, now(), now())
  `;
  for (const publication of [
    { createdAt: "2026-07-15T09:00:00Z", id: parentId, parentId: null, state: "published" },
    { createdAt: "2020-01-01T00:00:00Z", id: candidateId, parentId, state: "staged" },
  ] as const) {
    await database`
      insert into publication (
        id, fingerprint, source_fingerprint, parent_publication_id, parser_version,
        authority_policy_version, projection_version, normalization_version, source_profile_version,
        state, artifact_count, created_at, published_at
      ) values (
        ${publication.id}, ${publication.id.replaceAll("-", "").padEnd(64, "0")}, ${"d".repeat(64)},
        ${publication.parentId}, 'uspto-application-xml-v2', 'v1', 'v1', 'v1', 'v1',
        ${publication.state}, 1, ${publication.createdAt},
        ${publication.state === "published" ? publication.createdAt : null}
      )
    `;
    await database`
      insert into publication_artifact (
        publication_id, artifact_id, discovery_id, artifact_version_id, artifact_version_sha256,
        parse_run_id, parse_run_digest, retained_version_fingerprint, source_from_date, source_to_date
      ) values (
        ${publication.id}, ${artifactId}, ${discoveryId}, ${versionId}, ${"a".repeat(64)},
        ${parseRunId}, ${"c".repeat(64)}, ${"a".repeat(64)}, '2026-07-15', '2026-07-15'
      )
    `;
  }
  await database`
    insert into corpus_state (
      id, published_through_date, complete_through_date, last_successful_merge_at, corpus_version, publication_id
    ) values ('uspto', current_date, current_date, now(), 1, ${parentId})
  `;

  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = createIngestionScheduler({ databaseUrl, pollMs: 60_000, reconcile: () => blocked });
  await scheduler.start();
  await waitForReconcileState("active");
  try {
    expect(await createSyncService(database).status()).toMatchObject({ activeState: "publishing", degraded: true });
    const operator = await createOperatorSyncService(database).status();
    expect(operator.datasets.find((dataset) => dataset.product === "TRTDXFAP")).toMatchObject({
      currentStage: "publishing",
      providerStopReason: "USPTO credential rejected",
      reason: null,
    });
  } finally {
    release();
    await scheduler.waitForFirstReconciliation();
    await scheduler.stop();
  }
});

test("an active parse wins after a failed delivery while preserving the stopped provider reason", async () => {
  const artifactId = randomUUID();
  const versionId = randomUUID();
  await database`insert into dataset_product (id) values ('TRTDXFAP'), ('TRTYRAP')`;
  await database`
    insert into source_lane (id, status, stop_reason, updated_at)
    values ('uspto-odp', 'stopped', 'USPTO credential rejected', '2026-07-15T11:00:00Z')
  `;
  await database`insert into artifact (id, product_id, filename) values (${artifactId}, 'TRTDXFAP', 'apc260715.zip')`;
  await database`
    insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
    values (${versionId}, ${artifactId}, ${"a".repeat(64)}, 100, 'fixture/apc260715.zip', 'verified')
  `;
  await database`
    insert into artifact_discovery (
      id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
      expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
    ) values (
      ${randomUUID()}, ${artifactId}, ${versionId}, ${"b".repeat(64)}, now(), 'verified',
      'https://example.test/apc260715.zip', 100, current_date, current_date, current_date, now()
    )
  `;
  await database`
    insert into corpus_state (id, published_through_date, complete_through_date, last_successful_merge_at, corpus_version)
    values ('uspto', current_date, current_date, now(), 1)
  `;
  const failed = createIngestionScheduler({
    databaseUrl,
    pollMs: 60_000,
    reconcile: async () => { throw new Error("previous parse delivery failed"); },
  });
  await failed.start();
  expect(await failed.waitForFirstReconciliation()).toEqual({ ok: false });
  await waitForReconcileState("failed");
  await failed.stop();

  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const recovering = createIngestionScheduler({ databaseUrl, pollMs: 60_000, reconcile: () => blocked });
  await recovering.start();
  await waitForReconcileState("active");
  try {
    expect(await createSyncService(database).status()).toMatchObject({
      activeState: "parsing",
      degraded: true,
      failedCount: 1,
    });
    const operator = await createOperatorSyncService(database).status();
    expect(operator.datasets.find((dataset) => dataset.product === "TRTDXFAP")).toMatchObject({
      currentStage: "parsing",
      failedCount: 1,
      providerStopReason: "USPTO credential rejected",
      reason: null,
    });
  } finally {
    release();
    await recovering.waitForFirstReconciliation();
    await recovering.stop();
  }
});

test("operator artifact reads filter and count in PostgreSQL before bounded pagination", async () => {
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "operator-session" ? "user_artifact_operator" : null,
  });

  try {
    const account = await server.inject({
      method: "GET",
      url: "/api/trpc/account.me",
      headers: { authorization: "Bearer operator-session" },
    });
    await database`
      insert into role_assignment (account_id, role)
      values (${account.json().result.data.accountId}, 'operator')
    `;
    await database`insert into dataset_product (id) values ('TRTDXFAP'), ('TRTYRAP')`;

    const tracerArtifactId = randomUUID();
    await database`
      insert into artifact (id, product_id, filename)
      values (${tracerArtifactId}, 'TRTDXFAP', '__tracer__')
    `;
    await database`
      insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
      values (${randomUUID()}, ${tracerArtifactId}, ${"f".repeat(64)}, 1, 'fixture/tracer', 'published')
    `;

    for (const artifact of [
      { filename: "apc260713.zip", observedAt: "2026-07-14T12:00:00Z", product: "TRTDXFAP" },
      { filename: "apc260714.zip", observedAt: "2026-07-15T12:00:00Z", product: "TRTDXFAP" },
      { filename: "apc18840407-20251231-01.zip", observedAt: "2026-07-15T13:00:00Z", product: "TRTYRAP" },
    ]) {
      const artifactId = randomUUID();
      await database`
        insert into artifact (id, product_id, filename, created_at, updated_at)
        values (${artifactId}, ${artifact.product}, ${artifact.filename}, ${artifact.observedAt}, ${artifact.observedAt})
      `;
      await database`
        insert into artifact_discovery (
          id, artifact_id, fingerprint, observed_at, download_state, download_url,
          expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
        ) values (
          ${randomUUID()}, ${artifactId}, ${randomUUID().replaceAll("-", "").padEnd(64, "0")},
          ${artifact.observedAt}, 'pending', ${`https://api.uspto.gov/${artifact.filename}`}, 100,
          ${artifact.product === "TRTYRAP" ? "1884-04-07" : artifact.filename === "apc260713.zip" ? "2026-07-13" : "2026-07-14"},
          ${artifact.product === "TRTYRAP" ? "2025-12-31" : artifact.filename === "apc260713.zip" ? "2026-07-13" : "2026-07-14"},
          '2026-07-15', ${artifact.observedAt}
        )
      `;
    }

    const input = encodeURIComponent(JSON.stringify({ limit: 1, offset: 1, product: "TRTDXFAP" }));
    const response = await server.inject({
      method: "GET",
      url: `/api/trpc/ops.sync.artifacts?input=${input}`,
      headers: { authorization: "Bearer operator-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toEqual({
      items: [{
        artifactId: expect.any(String),
        artifactVersionId: null,
        bytes: null,
        filename: "apc260713.zip",
        lastErrorAt: null,
        lastErrorCode: null,
        observedAt: "2026-07-14T12:00:00.000Z",
        parseRunId: null,
        product: "TRTDXFAP",
        quarantineReason: null,
        retainedVersionCount: 0,
        selectedArtifactVersionId: null,
        selectedSha256: null,
        selectionRequired: false,
        sha256: null,
        sourceFromDate: "2026-07-13",
        sourceToDate: "2026-07-13",
        stage: "pending",
        stageSince: "2026-07-14T12:00:00.000Z",
      }],
      limit: 1,
      offset: 1,
      total: 2,
    });
  } finally {
    await server.close();
  }
});

test("operator artifact-version reads expose every retained reissue option through bounded pages", async () => {
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "operator-session" ? "user_version_operator" : null,
  });
  try {
    const account = await server.inject({
      method: "GET",
      url: "/api/trpc/account.me",
      headers: { authorization: "Bearer operator-session" },
    });
    await database`
      insert into role_assignment (account_id, role)
      values (${account.json().result.data.accountId}, 'operator')
    `;
    await database`insert into dataset_product (id) values ('TRTDXFAP')`;
    const artifactId = randomUUID();
    const selectedId = randomUUID();
    const alternateId = randomUUID();
    const selectedSha = "a".repeat(64);
    const alternateSha = "b".repeat(64);
    await database`
      insert into artifact (id, product_id, filename)
      values (${artifactId}, 'TRTDXFAP', 'apc260715.zip')
    `;
    for (const [versionId, sha, observedAt] of [
      [selectedId, selectedSha, "2026-07-15T10:00:00Z"],
      [alternateId, alternateSha, "2026-07-15T11:00:00Z"],
    ] as const) {
      await database`
        insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state, created_at)
        values (${versionId}, ${artifactId}, ${sha}, 100, ${`fixture/${sha}`}, 'staged', ${observedAt})
      `;
      await database`
        insert into artifact_discovery (
          id, artifact_id, artifact_version_id, fingerprint, observed_at, download_state, download_url,
          expected_bytes, source_from_date, source_to_date, release_date, source_last_modified_at
        ) values (
          ${randomUUID()}, ${artifactId}, ${versionId}, ${sha}, ${observedAt}, 'verified',
          'https://example.test/apc260715.zip', 100, '2026-07-15', '2026-07-15', '2026-07-15', ${observedAt}
        )
      `;
      await database`
        insert into parse_run (
          id, artifact_version_id, state, parser_version, digest, started_at, finished_at
        ) values (
          ${randomUUID()}, ${versionId}, 'staged', 'uspto-application-xml-v2', ${sha}, ${observedAt}, ${observedAt}
        )
      `;
    }
    await database`
      insert into artifact_version_selection (
        artifact_id, artifact_version_id, retained_version_count, retained_version_fingerprint, reason
      ) values (
        ${artifactId}, ${selectedId}, 2, ${retainedVersionFingerprint([selectedSha, alternateSha])},
        'selected after provenance review'
      )
    `;

    const input = encodeURIComponent(JSON.stringify({ limit: 1, offset: 1, product: "TRTDXFAP" }));
    const response = await server.inject({
      method: "GET",
      url: `/api/trpc/ops.sync.artifact-versions?input=${input}`,
      headers: { authorization: "Bearer operator-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toEqual({
      items: [{
        artifactId,
        artifactVersionId: selectedId,
        bytes: 100,
        createdAt: "2026-07-15T10:00:00.000Z",
        filename: "apc260715.zip",
        observedAt: "2026-07-15T10:00:00.000Z",
        parseState: "staged",
        parserVersion: "uspto-application-xml-v2",
        product: "TRTDXFAP",
        quarantineReason: null,
        selected: true,
        sha256: selectedSha,
        sourceFromDate: "2026-07-15",
        sourceToDate: "2026-07-15",
        state: "staged",
      }],
      limit: 1,
      offset: 1,
      total: 2,
    });
  } finally {
    await server.close();
  }
});

test("operator publication reads stay bounded and newest-first", async () => {
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "operator-session" ? "user_publication_operator" : null,
  });

  try {
    const account = await server.inject({
      method: "GET",
      url: "/api/trpc/account.me",
      headers: { authorization: "Bearer operator-session" },
    });
    await database`
      insert into role_assignment (account_id, role)
      values (${account.json().result.data.accountId}, 'operator')
    `;
    const publishedId = randomUUID();
    const rejectedId = randomUUID();
    await database`
      insert into publication (
        id, fingerprint, source_fingerprint, parser_version, authority_policy_version, projection_version,
        normalization_version, source_profile_version, state, artifact_count, published_through_date,
        complete_through_date, corpus_version, created_at, published_at
      ) values (
        ${publishedId}, ${"1".repeat(64)}, ${"2".repeat(64)}, 'parser-v1', 'authority-v1', 'projection-v1',
        'normalization-v1', 'profile-v1', 'published', 91, '2025-12-31', '2025-12-31', 1,
        '2026-07-14T12:00:00Z', '2026-07-14T12:05:00Z'
      )
    `;
    await database`
      insert into publication (
        id, fingerprint, source_fingerprint, parent_publication_id, parser_version, authority_policy_version,
        projection_version, normalization_version, source_profile_version, state, artifact_count,
        created_at, rejected_at
      ) values (
        ${rejectedId}, ${"3".repeat(64)}, ${"4".repeat(64)}, ${publishedId}, 'parser-v1', 'authority-v1',
        'projection-v1', 'normalization-v1', 'profile-v1', 'rejected', 92,
        '2026-07-15T12:00:00Z', '2026-07-15T12:10:00Z'
      )
    `;
    await database`
      insert into publication_diagnostic (publication_id, diagnostic_key, kind, serial_number, details)
      values (
        ${rejectedId}, ${"5".repeat(64)}, 'authority-conflict', '60146682',
        ${database.json({ kind: "authority-conflict", serialNumber: "60146682" })}
      )
    `;

    const input = encodeURIComponent(JSON.stringify({ limit: 1, offset: 0 }));
    const response = await server.inject({
      method: "GET",
      url: `/api/trpc/ops.sync.publications?input=${input}`,
      headers: { authorization: "Bearer operator-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toEqual({
      items: [{
        artifactCount: 92,
        completeThroughDate: null,
        corpusVersion: null,
        createdAt: "2026-07-15T12:00:00.000Z",
        diagnosticCount: 1,
        id: rejectedId,
        parentPublicationId: publishedId,
        publishedAt: null,
        publishedThroughDate: null,
        rejectedAt: "2026-07-15T12:10:00.000Z",
        state: "rejected",
      }],
      limit: 1,
      offset: 0,
      total: 2,
    });
  } finally {
    await server.close();
  }
});

test("operator rejection reads identify parser and publication failures without raw XML", async () => {
  const server = await buildServer({
    databaseUrl,
    logger: false,
    verifyClerkToken: async (token) => token === "operator-session" ? "user_rejection_operator" : null,
  });

  try {
    const account = await server.inject({
      method: "GET",
      url: "/api/trpc/account.me",
      headers: { authorization: "Bearer operator-session" },
    });
    await database`
      insert into role_assignment (account_id, role)
      values (${account.json().result.data.accountId}, 'operator')
    `;
    const artifactId = randomUUID();
    const versionId = randomUUID();
    const parseRunId = randomUUID();
    const parseRejectId = randomUUID();
    await database`insert into dataset_product (id) values ('TRTDXFAP')`;
    await database`
      insert into artifact (id, product_id, filename)
      values (${artifactId}, 'TRTDXFAP', 'apc260714.zip')
    `;
    await database`
      insert into artifact_version (id, artifact_id, sha256, bytes, object_key, state)
      values (${versionId}, ${artifactId}, ${"a".repeat(64)}, 100, 'sha256/aa/object', 'quarantined')
    `;
    await database`
      insert into parse_run (
        id, artifact_version_id, state, parser_version, digest, record_count, reject_count,
        started_at, finished_at
      ) values (
        ${parseRunId}, ${versionId}, 'quarantined', 'parser-v1', ${"b".repeat(64)}, 0, 1,
        '2026-07-14T12:00:00Z', '2026-07-14T12:01:00Z'
      )
    `;
    await database`
      insert into parse_reject (
        id, parse_run_id, physical_record_index, reason, raw_xml, bytes, digest, created_at
      ) values (
        ${parseRejectId}, ${parseRunId}, 12, 'malformed or truncated XML', ${Buffer.from("secret raw XML")},
        14, ${"c".repeat(64)}, '2026-07-14T12:01:00Z'
      )
    `;

    const publicationId = randomUUID();
    const diagnosticKey = "d".repeat(64);
    await database`
      insert into publication (
        id, fingerprint, source_fingerprint, parser_version, authority_policy_version, projection_version,
        normalization_version, source_profile_version, state, artifact_count, created_at, rejected_at
      ) values (
        ${publicationId}, ${"e".repeat(64)}, ${"f".repeat(64)}, 'parser-v1', 'authority-v1', 'projection-v1',
        'normalization-v1', 'profile-v1', 'rejected', 92, '2026-07-15T12:00:00Z', '2026-07-15T12:10:00Z'
      )
    `;
    await database`
      insert into publication_diagnostic (publication_id, diagnostic_key, kind, serial_number, details)
      values (
        ${publicationId}, ${diagnosticKey}, 'authority-conflict', '60146682',
        ${database.json({
          claimPath: "case-file/case-file-header/mark-identification",
          competingValues: ["ONE", "TWO"],
          group: "mark-presentation",
          kind: "authority-conflict",
          observations: [{
            artifactVersionSha256: "a".repeat(64),
            physicalRecordIndex: 42,
            product: "TRTDXFAP",
          }],
          policyVersion: "authority-v1",
          serialNumber: "60146682",
        })}
      )
    `;

    const input = encodeURIComponent(JSON.stringify({ limit: 10, offset: 0 }));
    const response = await server.inject({
      method: "GET",
      url: `/api/trpc/ops.sync.rejects?input=${input}`,
      headers: { authorization: "Bearer operator-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("secret raw XML");
    expect(response.json().result.data).toEqual({
      items: [
        {
          artifactVersionSha256: "a".repeat(64),
          bytes: null,
          claimPath: "case-file/case-file-header/mark-identification",
          createdAt: "2026-07-15T12:10:00.000Z",
          diagnostic: { competingValues: ["ONE", "TWO"], policyVersion: "authority-v1" },
          digest: null,
          filename: "apc260714.zip",
          group: "mark-presentation",
          id: diagnosticKey,
          kind: "authority-conflict",
          parseRunId: null,
          physicalRecordIndex: 42,
          product: "TRTDXFAP",
          publicationId,
          reason: "authority-conflict",
          serialNumber: "60146682",
        },
        {
          artifactVersionSha256: "a".repeat(64),
          bytes: 14,
          claimPath: null,
          createdAt: "2026-07-14T12:01:00.000Z",
          diagnostic: null,
          digest: "c".repeat(64),
          filename: "apc260714.zip",
          group: null,
          id: parseRejectId,
          kind: "parse-reject",
          parseRunId,
          physicalRecordIndex: 12,
          product: "TRTDXFAP",
          publicationId: null,
          reason: "malformed or truncated XML",
          serialNumber: null,
        },
      ],
      limit: 10,
      offset: 0,
      total: 2,
    });
  } finally {
    await server.close();
  }
});
