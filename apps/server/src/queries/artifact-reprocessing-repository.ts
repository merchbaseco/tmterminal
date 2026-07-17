import type postgres from "postgres";

import { isPublicationPolicyArtifact } from "../ingestion/publication-policy.ts";
import { sourceObservationParserVersion } from "../ingestion/source-observations.ts";
import { lockCorpusPublication } from "./corpus-publication-lock.ts";

const previousParserVersion = "uspto-application-xml-v4";
const requiredParserVersion = "uspto-application-xml-v5";

interface ReprocessingTarget {
  artifactId: string;
  artifactVersionId: string;
  corpusStates: number;
  currentParserRuns: number;
  discoveryArtifactVersionId: string | null;
  discoveryId: string | null;
  discoveryState: string | null;
  filename: string;
  latestDiscoveryCount: number;
  objectKey: string | null;
  previousParseDigest: string | null;
  previousParseFinishedAt: Date | null;
  previousParseRejectCount: number | null;
  previousParseRejectRows: number;
  previousParseState: string | null;
  product: string;
  publishedMemberships: number;
  sha256: string;
  sourceFromDate: string | null;
  sourceToDate: string | null;
  versionState: string;
}

function validateReprocessingTarget(
  target: ReprocessingTarget | undefined
): asserts target is ReprocessingTarget {
  if (!target) {
    throw new Error("Artifact version does not exist");
  }
  if (target.corpusStates > 0 || target.publishedMemberships > 0) {
    throw new Error("Artifact reprocessing requires the unpublished first annual corpus");
  }
  if (
    !(
      target.sourceFromDate &&
      target.sourceToDate &&
      isPublicationPolicyArtifact({
        filename: target.filename,
        product: target.product,
        sourceFromDate: target.sourceFromDate,
        sourceToDate: target.sourceToDate,
      })
    )
  ) {
    throw new Error("Artifact version is outside the first annual publication policy");
  }
  if (target.versionState !== "staged" && target.versionState !== "quarantined") {
    throw new Error("Artifact version must have terminal parser v4 state");
  }
  if (target.objectKey !== null) {
    throw new Error("Artifact version still has retained bytes");
  }
  if (target.currentParserRuns > 0) {
    throw new Error("Artifact version already has a current parser run");
  }
  const terminalPreviousRun =
    target.previousParseDigest !== null &&
    target.previousParseFinishedAt !== null &&
    target.previousParseState === target.versionState;
  const stagedEvidence = target.versionState === "staged" && target.previousParseRejectCount === 0;
  const quarantinedEvidence =
    target.versionState === "quarantined" &&
    (target.previousParseRejectCount ?? 0) > 0 &&
    target.previousParseRejectRows > 0;
  if (!(terminalPreviousRun && (stagedEvidence || quarantinedEvidence))) {
    throw new Error("Artifact version lacks durable terminal parser v4 evidence");
  }
  if (
    target.latestDiscoveryCount !== 1 ||
    !target.discoveryId ||
    target.discoveryState !== "verified" ||
    target.discoveryArtifactVersionId !== target.artifactVersionId
  ) {
    throw new Error("Artifact version is not the single latest verified discovery");
  }
}

export function resetArtifactVersionForReprocessing(
  database: postgres.Sql,
  artifactVersionId: string,
  reason: string
) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error("Artifact reprocessing requires a reason");
  }
  if (sourceObservationParserVersion !== requiredParserVersion) {
    throw new Error("Artifact reprocessing requires parser v5");
  }
  return database.begin(async (transaction) => {
    await lockCorpusPublication(transaction);
    const [target] = await transaction<ReprocessingTarget[]>`
      select
        artifact.id as "artifactId",
        version.id as "artifactVersionId",
        version.object_key as "objectKey",
        version.sha256,
        version.state::text as "versionState",
        artifact.filename,
        artifact.product_id as product,
        latest.id as "discoveryId",
        latest.artifact_version_id as "discoveryArtifactVersionId",
        latest.download_state::text as "discoveryState",
        latest.source_from_date::text as "sourceFromDate",
        latest.source_to_date::text as "sourceToDate",
        coalesce(latest_at.count, 0)::int as "latestDiscoveryCount",
        previous.state::text as "previousParseState",
        previous.digest as "previousParseDigest",
        previous.finished_at as "previousParseFinishedAt",
        previous.reject_count as "previousParseRejectCount",
        (select count(*)::int from parse_reject where parse_run_id = previous.id)
          as "previousParseRejectRows",
        (select count(*)::int from parse_run current
          where current.artifact_version_id = version.id
            and current.parser_version = ${sourceObservationParserVersion}) as "currentParserRuns",
        (select count(*)::int from corpus_state) as "corpusStates",
        (select count(*)::int
          from publication_artifact member
          join publication on publication.id = member.publication_id
          where member.artifact_version_id = version.id and publication.state = 'published')
          as "publishedMemberships"
      from artifact_version version
      join artifact on artifact.id = version.artifact_id
      left join parse_run previous on previous.artifact_version_id = version.id
        and previous.parser_version = ${previousParserVersion}
      left join lateral (
        select discovery.id, discovery.artifact_version_id, discovery.download_state,
          discovery.source_from_date, discovery.source_to_date, discovery.observed_at
        from artifact_discovery discovery
        where discovery.artifact_id = artifact.id
        order by discovery.observed_at desc, discovery.id desc
        limit 1
      ) latest on true
      left join lateral (
        select count(*)::int as count
        from artifact_discovery discovery
        where discovery.artifact_id = artifact.id and discovery.observed_at = latest.observed_at
      ) latest_at on true
      where version.id = ${artifactVersionId}
    `;
    validateReprocessingTarget(target);
    const [version] = await transaction<Array<{ id: string }>>`
      update artifact_version
      set state = 'verified', quarantined_at = null, quarantine_reason = null
      where id = ${target.artifactVersionId}
        and state = ${target.versionState}
        and object_key is null
      returning id
    `;
    const [discovery] = await transaction<Array<{ id: string }>>`
      update artifact_discovery
      set download_state = 'pending', artifact_version_id = null
      where id = ${target.discoveryId}
        and artifact_version_id = ${target.artifactVersionId}
        and download_state = 'verified'
      returning id
    `;
    if (!(version && discovery)) {
      throw new Error("Artifact reprocessing target changed before reset");
    }
    return {
      artifactId: target.artifactId,
      artifactVersionId: target.artifactVersionId,
      discoveryId: target.discoveryId,
      filename: target.filename,
      previousState: target.versionState as "quarantined" | "staged",
      product: target.product,
      reason: normalizedReason,
      sha256: target.sha256,
    };
  });
}
