import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

import type { CanonicalDiagnostic } from "../ingestion/canonical-mark-types.ts";
import { retainedVersionFingerprint } from "../ingestion/artifact-version-selection.ts";
import { sourceObservationParserVersion, type SourceObservation } from "../ingestion/source-observations.ts";
type Database = postgres.Sql | postgres.TransactionSql;

export type PublicationSemanticVersions = {
  authorityPolicy: string;
  normalization: string;
  parser: string;
  projection: string;
  sourceProfile: string;
};

export type EligibleParseRun = {
  artifactId: string;
  artifactVersionId: string;
  artifactVersionSha256: string;
  discoveryId: string;
  filename: string;
  parseRunDigest: string;
  parseRunId: string;
  product: string;
  retainedVersionCount: number;
  retainedVersionSha256s: string[];
  sourceFromDate: string;
  sourceToDate: string;
};

export async function readEligibleParseRuns(database: Database) {
  return database<EligibleParseRun[]>`
    select
      a.id as "artifactId",
      v.id as "artifactVersionId",
      v.sha256 as "artifactVersionSha256",
      d.id as "discoveryId",
      a.filename,
      p.digest as "parseRunDigest",
      p.id as "parseRunId",
      a.product_id as product,
      retained.count as "retainedVersionCount", retained.sha256s as "retainedVersionSha256s",
      d.source_from_date::text as "sourceFromDate",
      d.source_to_date::text as "sourceToDate"
    from artifact a
    join artifact_version v on v.artifact_id = a.id
    join lateral (
      select count(*)::int as count, array_agg(sha256 order by sha256) as sha256s
      from artifact_version where artifact_id = a.id
    ) retained on true
    join lateral (
      select id, source_from_date, source_to_date
      from artifact_discovery
      where artifact_id = a.id and artifact_version_id = v.id and download_state = 'verified'
      order by observed_at desc, id desc
      limit 1
    ) d on true
    join parse_run p on p.artifact_version_id = v.id
    where p.parser_version = ${sourceObservationParserVersion}
      and p.state = 'staged'
      and p.reject_count = 0
      and p.digest is not null
      and v.state in ('staged', 'published')
    order by a.product_id, a.filename, v.sha256
  `;
}

export async function readArtifactVersionSelections(database: Database) {
  const rows = await database<Array<{
    artifactVersionSha256: string;
    filename: string;
    product: string;
    retainedVersionFingerprint: string;
    retainedVersionSha256s: string[];
  }>>`
    select
      selected.sha256 as "artifactVersionSha256",
      artifact.filename,
      artifact.product_id as product,
      selection.retained_version_fingerprint as "retainedVersionFingerprint",
      retained.sha256s as "retainedVersionSha256s"
    from artifact_version_selection selection
    join artifact on artifact.id = selection.artifact_id
    join artifact_version selected on selected.id = selection.artifact_version_id
      and selected.artifact_id = selection.artifact_id
    join lateral (
      select count(*)::int as count, array_agg(sha256 order by sha256) as sha256s
      from artifact_version where artifact_id = selection.artifact_id
    ) retained on retained.count = selection.retained_version_count
    join parse_run run on run.artifact_version_id = selected.id
      and run.parser_version = ${sourceObservationParserVersion}
      and run.state = 'staged'
    order by artifact.product_id, artifact.filename
  `;
  return rows
    .filter((row) => retainedVersionFingerprint(row.retainedVersionSha256s) === row.retainedVersionFingerprint)
    .map(({ retainedVersionFingerprint: _fingerprint, retainedVersionSha256s: _sha256s, ...selection }) => selection);
}

export async function readCurrentPublicationArtifactIds(database: Database) {
  const rows = await database<Array<{ artifactId: string }>>`
    select artifact.artifact_id as "artifactId"
    from corpus_state state
    join publication_artifact artifact on artifact.publication_id = state.publication_id
    where state.id = 'uspto'
    order by artifact.artifact_id
  `;
  return rows.map((row) => row.artifactId);
}

export async function readUnresolvedLatestDiscoveries(database: Database) {
  return database<Array<{ artifactId: string; filename: string; product: string }>>`
    select latest."artifactId", latest.filename, latest.product
    from (
      select distinct on (a.id)
        a.id as "artifactId", a.filename, a.product_id as product, d.download_state
      from artifact a
      join artifact_discovery d on d.artifact_id = a.id
      order by a.id, d.observed_at desc, d.id desc
    ) latest
    where latest.download_state <> 'verified'
    order by latest.product, latest.filename
  `;
}

export async function stagePublicationCandidate(
  database: Database,
  sourceFingerprint: string,
  versions: PublicationSemanticVersions,
  parseRuns: Array<EligibleParseRun & { retainedVersionFingerprint: string; selectedExplicitly: boolean }>,
) {
  const [current] = await database<Array<{
    artifactCount: number;
    authorityPolicyVersion: string;
    normalizationVersion: string;
    parserVersion: string;
    projectionVersion: string;
    publicationId: string;
    sourceFingerprint: string;
    sourceProfileVersion: string;
    state: "published" | "rejected" | "staged";
  }>>`
    select p.artifact_count as "artifactCount", p.authority_policy_version as "authorityPolicyVersion",
      p.normalization_version as "normalizationVersion", p.parser_version as "parserVersion",
      p.projection_version as "projectionVersion", p.id as "publicationId",
      p.source_fingerprint as "sourceFingerprint", p.source_profile_version as "sourceProfileVersion", p.state
    from corpus_state state
    join publication p on p.id = state.publication_id
    where state.id = 'uspto'
  `;
  if (
    current?.sourceFingerprint === sourceFingerprint &&
    current.parserVersion === versions.parser &&
    current.authorityPolicyVersion === versions.authorityPolicy &&
    current.projectionVersion === versions.projection &&
    current.normalizationVersion === versions.normalization &&
    current.sourceProfileVersion === versions.sourceProfile
  ) {
    if (current.state !== "published") throw new Error("Current corpus publication is not published");
    return {
      artifactCount: current.artifactCount,
      candidateId: current.publicationId,
      state: current.state,
    };
  }
  const parentPublicationId = current?.publicationId ?? null;
  const fingerprint = createHash("sha256").update(JSON.stringify([
    sourceFingerprint,
    parentPublicationId,
  ])).digest("hex");
  const candidateId = randomUUID();
  const [inserted] = await database<Array<{ id: string }>>`
    insert into publication (
      id, fingerprint, source_fingerprint, parent_publication_id, parser_version,
      authority_policy_version, projection_version, normalization_version, source_profile_version,
      artifact_count
    ) values (
      ${candidateId}, ${fingerprint}, ${sourceFingerprint}, ${parentPublicationId}, ${versions.parser},
      ${versions.authorityPolicy}, ${versions.projection}, ${versions.normalization}, ${versions.sourceProfile},
      ${parseRuns.length}
    )
    on conflict (fingerprint) do nothing
    returning id
  `;
  if (inserted) {
    await database`
      insert into publication_artifact ${database(parseRuns.map((run) => ({
        publication_id: candidateId,
        artifact_id: run.artifactId,
        discovery_id: run.discoveryId,
        artifact_version_id: run.artifactVersionId,
        artifact_version_sha256: run.artifactVersionSha256,
        parse_run_id: run.parseRunId,
        parse_run_digest: run.parseRunDigest,
        retained_version_fingerprint: run.retainedVersionFingerprint,
        selected_explicitly: run.selectedExplicitly,
        source_from_date: run.sourceFromDate,
        source_to_date: run.sourceToDate,
      })))}
    `;
    return { artifactCount: parseRuns.length, candidateId, state: "staged" as const };
  }
  const [existing] = await database<Array<{
    artifactCount: number;
    candidateId: string;
    state: "published" | "rejected" | "staged";
  }>>`
    select id as "candidateId", artifact_count as "artifactCount", state
    from publication where fingerprint = ${fingerprint}
  `;
  if (!existing) throw new Error("Publication candidate disappeared");
  return existing;
}

export type PublicationArtifactSnapshot = EligibleParseRun & {
  currentSelectedArtifactVersionId: string | null;
  currentSelectedRetainedVersionCount: number | null;
  currentSelectedRetainedVersionFingerprint: string | null;
  currentDiscoveryId: string;
  currentArtifactVersionSha256: string;
  currentParseRunDigest: string;
  currentSourceFromDate: string;
  currentSourceToDate: string;
  discoveryArtifactVersionId: string;
  discoveryState: string;
  parseRunState: string;
  rejectCount: number;
  retainedVersionFingerprint: string;
  selectedExplicitly: boolean;
  snapshotSourceFromDate: string;
  snapshotSourceToDate: string;
  versionState: string;
};

export async function readPublicationCandidate(database: Database, candidateId: string) {
  const [publication] = await database<Array<{
    artifactCount: number;
    authorityPolicyVersion: string;
    fingerprint: string;
    normalizationVersion: string;
    parentPublicationId: string | null;
    parserVersion: string;
    projectionVersion: string;
    sourceFingerprint: string;
    sourceProfileVersion: string;
    state: "published" | "rejected" | "staged";
  }>>`
    select artifact_count as "artifactCount", authority_policy_version as "authorityPolicyVersion",
      fingerprint, normalization_version as "normalizationVersion",
      parent_publication_id as "parentPublicationId", parser_version as "parserVersion",
      projection_version as "projectionVersion", source_fingerprint as "sourceFingerprint",
      source_profile_version as "sourceProfileVersion", state
    from publication where id = ${candidateId}
    for update
  `;
  if (!publication) throw new Error("Publication candidate not found");
  const artifacts = await database<PublicationArtifactSnapshot[]>`
    select
      a.id as "artifactId",
      pa.discovery_id as "discoveryId",
      current_d.id as "currentDiscoveryId",
      pa.artifact_version_id as "artifactVersionId",
      pa.artifact_version_sha256 as "artifactVersionSha256",
      v.sha256 as "currentArtifactVersionSha256",
      a.filename,
      pa.parse_run_digest as "parseRunDigest",
      p.digest as "currentParseRunDigest",
      pa.parse_run_id as "parseRunId",
      p.state as "parseRunState",
      p.reject_count as "rejectCount",
      retained.count as "retainedVersionCount", retained.sha256s as "retainedVersionSha256s",
      a.product_id as product,
      pa.source_from_date::text as "sourceFromDate",
      pa.source_to_date::text as "sourceToDate",
      snapshot_d.artifact_version_id as "discoveryArtifactVersionId",
      snapshot_d.download_state as "discoveryState",
      snapshot_d.source_from_date::text as "snapshotSourceFromDate",
      snapshot_d.source_to_date::text as "snapshotSourceToDate",
      current_d.source_from_date::text as "currentSourceFromDate",
      current_d.source_to_date::text as "currentSourceToDate",
      selection.artifact_version_id as "currentSelectedArtifactVersionId",
      selection.retained_version_count as "currentSelectedRetainedVersionCount",
      selection.retained_version_fingerprint as "currentSelectedRetainedVersionFingerprint",
      pa.retained_version_fingerprint as "retainedVersionFingerprint",
      pa.selected_explicitly as "selectedExplicitly",
      v.state as "versionState"
    from publication_artifact pa
    join artifact a on a.id = pa.artifact_id
    join artifact_version v on v.id = pa.artifact_version_id
    join lateral (
      select count(*)::int as count, array_agg(sha256 order by sha256) as sha256s
      from artifact_version where artifact_id = a.id
    ) retained on true
    join parse_run p on p.id = pa.parse_run_id
    left join artifact_version_selection selection on selection.artifact_id = a.id
    join artifact_discovery snapshot_d on snapshot_d.id = pa.discovery_id
    join lateral (
      select id, source_from_date, source_to_date
      from artifact_discovery
      where artifact_id = a.id and artifact_version_id = v.id and download_state = 'verified'
      order by observed_at desc, id desc
      limit 1
    ) current_d on true
    where pa.publication_id = ${candidateId}
    order by a.product_id, a.filename, v.sha256
  `;
  return { ...publication, artifacts };
}

export async function* readPublicationObservations(database: Database, candidateId: string) {
  type PublicationObservation = SourceObservation & { sourceRecordId: string };
  let after: PublicationObservation | undefined;
  const batchSize = 500;
  while (true) {
    const rows = await database<PublicationObservation[]>`
      select r.action_key as "actionKey", r.action_occurrence as "actionOccurrence",
        r.action_record_index as "actionRecordIndex", r.digest,
        r.physical_record_index as "physicalRecordIndex", a.product_id as product,
        r.id as "sourceRecordId", v.sha256 as "artifactVersionSha256", r.profile,
        r.schema_version as "schemaVersion", r.schema_version_date as "schemaVersionDate",
        r.serial_number as "serialNumber", r.source_transaction_date::text as "sourceTransactionDate",
        r.source_transaction_date_raw as "sourceTransactionDateRaw", r.values,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'occurrence', claim.occurrence, 'operation', claim.operation, 'path', claim.path,
              'presence', claim.presence, 'rawValue', claim.raw_value
            ) order by claim.claim_order
          ) filter (where claim.id is not null), '[]'::jsonb
        ) as claims
      from publication_artifact publication_source
      join parse_run parse on parse.id = publication_source.parse_run_id
      join source_record r on r.parse_run_id = parse.id
      join artifact_version v on v.id = parse.artifact_version_id
      join artifact a on a.id = v.artifact_id
      left join source_claim claim on claim.source_record_id = r.id
      where publication_source.publication_id = ${candidateId}
        ${after ? database`and (r.serial_number, a.product_id, v.sha256, r.physical_record_index, r.id) > (${
          after.serialNumber
        }, ${after.product}, ${after.artifactVersionSha256}, ${after.physicalRecordIndex}, ${after.sourceRecordId})` : database``}
      group by r.id, a.product_id, v.sha256
      order by r.serial_number, a.product_id, v.sha256, r.physical_record_index, r.id
      limit ${batchSize}
    `;
    for (const { sourceRecordId: _sourceRecordId, ...observation } of rows) yield observation;
    if (rows.length < batchSize) return;
    after = rows.at(-1)!;
  }
}

export async function readPublishedPublication(database: Database, candidateId: string) {
  const [result] = await database<Array<{
    changed: boolean;
    completeThroughDate: string;
    corpusVersion: number;
    eventId: string;
    publishedThroughDate: string;
  }>>`
    select (e.payload->>'changed')::boolean as changed,
      p.complete_through_date::text as "completeThroughDate", p.corpus_version as "corpusVersion",
      e.id as "eventId", p.published_through_date::text as "publishedThroughDate"
    from publication p
    join corpus_event e on e.publication_id = p.id and e.kind = 'corpus-published'
    where p.id = ${candidateId} and p.state = 'published'
  `;
  return result ? { ...result, corpusVersion: Number(result.corpusVersion) } : null;
}

export async function finishPublication(
  database: Database,
  input: {
    candidateId: string;
    changed: boolean;
    completeThroughDate: string;
    corpusVersion: number;
    publishedThroughDate: string;
  },
) {
  const eventId = randomUUID();
  await database`
    update artifact_version set state = 'published'
    where id in (
      select artifact_version_id from publication_artifact where publication_id = ${input.candidateId}
    )
  `;
  await database`
    insert into corpus_state (
      id, published_through_date, complete_through_date, last_successful_merge_at, corpus_version, publication_id
    ) values (
      'uspto', ${input.publishedThroughDate}, ${input.completeThroughDate}, now(), ${input.corpusVersion},
      ${input.candidateId}
    )
    on conflict (id) do update set
      published_through_date = excluded.published_through_date,
      complete_through_date = excluded.complete_through_date,
      last_successful_merge_at = excluded.last_successful_merge_at,
      corpus_version = excluded.corpus_version,
      publication_id = excluded.publication_id
  `;
  await database`
    update publication set state = 'published', published_at = now(), published_through_date = ${input.publishedThroughDate},
      complete_through_date = ${input.completeThroughDate}, corpus_version = ${input.corpusVersion}
    where id = ${input.candidateId}
  `;
  await database`
    insert into corpus_event (id, publication_id, kind, corpus_version, payload)
    values (
      ${eventId}, ${input.candidateId}, 'corpus-published', ${input.corpusVersion},
      ${database.json({
        changed: input.changed,
        completeThroughDate: input.completeThroughDate,
        publishedThroughDate: input.publishedThroughDate,
      })}
    )
  `;
  await database`select pg_notify('corpus_events', ${eventId})`;
  return eventId;
}

export async function readCorpusVersion(database: Database) {
  const [state] = await database<Array<{ corpusVersion: number }>>`
    select corpus_version as "corpusVersion" from corpus_state where id = 'uspto'
  `;
  return Number(state?.corpusVersion ?? 0);
}

export async function readCorpusPublicationId(database: Database) {
  const [state] = await database<Array<{ publicationId: string }>>`
    select publication_id as "publicationId" from corpus_state where id = 'uspto'
  `;
  return state?.publicationId ?? null;
}

export async function appendPublicationDiagnostics(
  database: Database,
  candidateId: string,
  diagnostics: CanonicalDiagnostic[],
) {
  if (diagnostics.length === 0) return;
  const rows = diagnostics.map((diagnostic) => ({
    details: diagnostic,
    diagnosticKey: createHash("sha256").update(JSON.stringify(diagnostic)).digest("hex"),
    kind: diagnostic.kind,
    serialNumber: diagnostic.serialNumber,
  }));
  await database`
    insert into publication_diagnostic (publication_id, diagnostic_key, kind, serial_number, details)
    select ${candidateId}, row."diagnosticKey", row.kind::publication_diagnostic_kind, row."serialNumber", row.details
    from jsonb_to_recordset(${database.json(rows as never)})
      as row("diagnosticKey" text, kind text, "serialNumber" text, details jsonb)
    on conflict do nothing
  `;
}

export async function rejectPublication(database: Database, candidateId: string) {
  await database`update publication set state = 'rejected', rejected_at = now() where id = ${candidateId}`;
  return readRejectedPublication(database, candidateId);
}

export async function readRejectedPublication(database: Database, candidateId: string) {
  const [result] = await database<Array<{ diagnosticCount: number }>>`
    select count(*)::int as "diagnosticCount" from publication_diagnostic
    where publication_id = ${candidateId}
  `;
  return { candidateId, diagnosticCount: result?.diagnosticCount ?? 0, status: "rejected" as const };
}
