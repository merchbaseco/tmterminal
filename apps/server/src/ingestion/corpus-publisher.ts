import { createHash } from "node:crypto";
import type postgres from "postgres";
import { publishCanonicalMarks } from "../queries/canonical-mark-repository.ts";
import { lockCorpusPublication } from "../queries/corpus-publication-lock.ts";
import {
  appendPublicationDiagnostics,
  type EligibleParseRun,
  finishPublication,
  readArtifactVersionSelections,
  readCorpusPublicationId,
  readCorpusVersion,
  readEligibleParseRuns,
  readPublicationCandidate,
  readPublicationObservations,
  readPublishedPublication,
  readRejectedPublication,
  readUnresolvedLatestDiscoveries,
  rejectPublication,
  stagePublicationCandidate,
} from "../queries/corpus-publication-repository.ts";
import { annualGenerationV1MetadataSha256 } from "./annual-generation-v1.ts";
import { retainedVersionFingerprint } from "./artifact-version-selection.ts";
import {
  type CanonicalDiagnostic,
  type CanonicalizationResult,
  canonicalVersions,
  type ResolvedCanonicalMark,
} from "./canonical-mark-types.ts";
import { canonicalizeMark } from "./canonical-marks.ts";
import {
  annualGenerationArtifactCount,
  isPublicationPolicyArtifact,
  isPublicationPolicyDiscovery,
} from "./publication-policy.ts";
import { type SourceObservation, sourceObservationParserVersion } from "./source-observations.ts";

const canonicalBatchSize = 250;
const annualBaselineThroughDate = "2025-12-31";
const publicationSemanticVersions = {
  authorityPolicy: canonicalVersions.authorityPolicy,
  normalization: canonicalVersions.normalization,
  parser: sourceObservationParserVersion,
  projection: canonicalVersions.projection,
  sourceProfile: canonicalVersions.sourceProfile,
} as const;

interface CandidateIdentity {
  artifactVersionSha256: string;
  discoveryId: string;
  filename: string;
  parseRunDigest: string;
  product: string;
  retainedVersionFingerprint: string;
  selectedExplicitly: boolean;
  sourceFromDate: string;
  sourceToDate: string;
}

type PublicationCandidate = Awaited<ReturnType<typeof readPublicationCandidate>>;
type CandidateArtifact = PublicationCandidate["artifacts"][number];
type EligibleGroup = [EligibleParseRun, ...EligibleParseRun[]];

function sourceFingerprint(artifacts: CandidateIdentity[]) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        annualGenerationV1MetadataSha256,
        publicationSemanticVersions.parser,
        publicationSemanticVersions.authorityPolicy,
        publicationSemanticVersions.projection,
        publicationSemanticVersions.normalization,
        publicationSemanticVersions.sourceProfile,
        artifacts.map((artifact) => [
          artifact.product,
          artifact.filename,
          artifact.artifactVersionSha256,
          artifact.parseRunDigest,
          artifact.discoveryId,
          artifact.sourceFromDate,
          artifact.sourceToDate,
          artifact.retainedVersionFingerprint,
          artifact.selectedExplicitly,
        ]),
      ])
    )
    .digest("hex");
}

function candidateFingerprint(sourceIdentity: string, parentPublicationId: string | null) {
  return createHash("sha256")
    .update(JSON.stringify([sourceIdentity, parentPublicationId]))
    .digest("hex");
}

function policyEligibleRows(rows: EligibleParseRun[]) {
  return rows.filter(isPublicationPolicyArtifact);
}

function artifactKey(artifact: Pick<EligibleParseRun, "filename" | "product">) {
  return `${artifact.product}\u0000${artifact.filename}`;
}

function groupEligibleRows(rows: EligibleParseRun[]) {
  const groups = new Map<string, EligibleGroup>();
  for (const row of rows) {
    const versions = groups.get(row.artifactId);
    if (versions) {
      versions.push(row);
    } else {
      groups.set(row.artifactId, [row]);
    }
  }
  return [...groups.values()];
}

function requestedReissues(reissues: Awaited<ReturnType<typeof readArtifactVersionSelections>>) {
  const requested = new Map<string, string>();
  for (const selection of reissues) {
    const key = artifactKey(selection);
    if (requested.has(key)) {
      throw new Error(`Duplicate reissue selection: ${selection.product}/${selection.filename}`);
    }
    requested.set(key, selection.artifactVersionSha256);
  }
  return requested;
}

function assertRequestedArtifactsExist(groups: EligibleGroup[], requested: Map<string, string>) {
  const eligibleKeys = new Set(groups.map(([first]) => artifactKey(first)));
  for (const key of requested.keys()) {
    if (!eligibleKeys.has(key)) {
      throw new Error(`Selected reissue artifact is not eligible: ${key.replace("\u0000", "/")}`);
    }
  }
}

function ambiguousGroups(groups: EligibleGroup[], requested: Map<string, string>) {
  return groups.filter(
    ([first]) => first.retainedVersionCount > 1 && !requested.has(artifactKey(first))
  );
}

function selectEligibleVersions(groups: EligibleGroup[], requested: Map<string, string>) {
  return groups
    .map((versions) => {
      const [first] = versions;
      const selectedSha256 = requested.get(artifactKey(first));
      const selected = selectedSha256
        ? versions.find((version) => version.artifactVersionSha256 === selectedSha256)
        : first;
      if (!selected) {
        throw new Error(`Selected reissue is not retained: ${first.product}/${first.filename}`);
      }
      return {
        ...selected,
        retainedVersionFingerprint: retainedVersionFingerprint(selected.retainedVersionSha256s),
        selectedExplicitly: selectedSha256 !== undefined && selected.retainedVersionCount > 1,
      };
    })
    .sort((left, right) => artifactKey(left).localeCompare(artifactKey(right)));
}

function assertCandidateShape(candidate: PublicationCandidate) {
  if (candidate.state !== "staged") {
    throw new Error(`Publication candidate is ${candidate.state}`);
  }
  if (candidate.artifacts.length !== candidate.artifactCount) {
    throw new Error("Publication candidate artifact set is incomplete");
  }
  if (
    candidate.parserVersion !== publicationSemanticVersions.parser ||
    candidate.authorityPolicyVersion !== publicationSemanticVersions.authorityPolicy ||
    candidate.projectionVersion !== publicationSemanticVersions.projection ||
    candidate.normalizationVersion !== publicationSemanticVersions.normalization ||
    candidate.sourceProfileVersion !== publicationSemanticVersions.sourceProfile
  ) {
    throw new Error("Publication candidate semantic versions changed");
  }
  const currentSourceFingerprint = sourceFingerprint(candidate.artifacts);
  if (
    candidate.sourceFingerprint !== currentSourceFingerprint ||
    candidate.fingerprint !==
      candidateFingerprint(currentSourceFingerprint, candidate.parentPublicationId)
  ) {
    throw new Error("Publication candidate identity changed");
  }
}

function artifactEligibilityChanged(artifact: CandidateArtifact) {
  return (
    artifact.discoveryId !== artifact.currentDiscoveryId ||
    artifact.discoveryArtifactVersionId !== artifact.artifactVersionId ||
    artifact.discoveryState !== "verified" ||
    artifact.artifactVersionSha256 !== artifact.currentArtifactVersionSha256 ||
    artifact.parseRunDigest !== artifact.currentParseRunDigest ||
    artifact.sourceFromDate !== artifact.snapshotSourceFromDate ||
    artifact.sourceToDate !== artifact.snapshotSourceToDate ||
    artifact.sourceFromDate !== artifact.currentSourceFromDate ||
    artifact.sourceToDate !== artifact.currentSourceToDate ||
    artifact.parseRunState !== "staged" ||
    artifact.rejectCount !== 0 ||
    (artifact.versionState !== "staged" && artifact.versionState !== "published") ||
    artifact.retainedVersionFingerprint !==
      retainedVersionFingerprint(artifact.retainedVersionSha256s) ||
    (!artifact.selectedExplicitly && artifact.retainedVersionCount !== 1) ||
    (artifact.selectedExplicitly &&
      (artifact.currentSelectedArtifactVersionId !== artifact.artifactVersionId ||
        artifact.currentSelectedRetainedVersionCount !== artifact.retainedVersionCount ||
        artifact.currentSelectedRetainedVersionFingerprint !== artifact.retainedVersionFingerprint))
  );
}

function assertAnnualSet(candidate: PublicationCandidate) {
  const annual = new Set(
    candidate.artifacts
      .filter(
        (artifact) =>
          artifact.product === "TRTYRAP" &&
          artifact.sourceFromDate === "1884-04-07" &&
          artifact.sourceToDate === annualBaselineThroughDate &&
          isPublicationPolicyArtifact(artifact)
      )
      .map((artifact) => artifact.filename)
  );
  if (annual.size !== annualGenerationArtifactCount()) {
    throw new Error("Pinned annual generation became incomplete");
  }
}

async function assertCandidateEligible(
  transaction: postgres.TransactionSql,
  candidate: PublicationCandidate
) {
  assertCandidateShape(candidate);
  if ((await readCorpusPublicationId(transaction)) !== candidate.parentPublicationId) {
    throw new Error("Publication candidate parent changed");
  }
  if ((await readUnresolvedLatestDiscoveries(transaction)).some(isPublicationPolicyDiscovery)) {
    throw new Error("Publication candidate source discovery is unresolved");
  }
  const eligibleArtifactIds = new Set(
    policyEligibleRows(await readEligibleParseRuns(transaction)).map(
      (artifact) => artifact.artifactId
    )
  );
  const candidateArtifactIds = new Set(candidate.artifacts.map((artifact) => artifact.artifactId));
  if (
    eligibleArtifactIds.size !== candidateArtifactIds.size ||
    [...eligibleArtifactIds].some((artifactId) => !candidateArtifactIds.has(artifactId))
  ) {
    throw new Error("Publication candidate complete eligible source set changed");
  }
  if (candidate.artifacts.some(artifactEligibilityChanged)) {
    throw new Error("Publication candidate eligibility changed");
  }
  assertAnnualSet(candidate);
}

async function validateCanonicalResults(transaction: postgres.TransactionSql, candidateId: string) {
  let diagnosticCount = 0;
  let diagnosticBatch: CanonicalDiagnostic[] = [];
  for await (const result of canonicalResults(transaction, candidateId)) {
    if (result.kind === "resolved") {
      continue;
    }
    diagnosticCount += result.diagnostics.length;
    diagnosticBatch.push(...result.diagnostics);
    if (diagnosticBatch.length >= canonicalBatchSize) {
      await appendPublicationDiagnostics(transaction, candidateId, diagnosticBatch);
      diagnosticBatch = [];
    }
  }
  await appendPublicationDiagnostics(transaction, candidateId, diagnosticBatch);
  return diagnosticCount;
}

async function materializeCanonicalResults(
  transaction: postgres.TransactionSql,
  candidateId: string
) {
  let changed = false;
  let materializations: ResolvedCanonicalMark[] = [];
  for await (const result of canonicalResults(transaction, candidateId)) {
    if (result.kind !== "resolved") {
      throw new Error("Publication validation changed inside transaction");
    }
    materializations.push(result);
    if (materializations.length >= canonicalBatchSize) {
      changed = (await publishCanonicalMarks(transaction, materializations)) || changed;
      materializations = [];
    }
  }
  return (await publishCanonicalMarks(transaction, materializations)) || changed;
}

async function* canonicalResults(
  database: postgres.Sql | postgres.TransactionSql,
  candidateId: string
): AsyncGenerator<CanonicalizationResult> {
  let observations: SourceObservation[] = [];
  let serialNumber: string | null = null;
  for await (const observation of readPublicationObservations(database, candidateId)) {
    const observedSerialNumber = observation.serialNumber;
    if (serialNumber !== null && observedSerialNumber !== serialNumber) {
      yield canonicalizeMark(observations);
      observations = [];
    }
    observations.push(observation);
    serialNumber = observedSerialNumber;
  }
  if (observations.length > 0) {
    yield canonicalizeMark(observations);
  }
}

export function createCorpusPublisher(database: postgres.Sql) {
  return {
    publish(candidateId: string) {
      return database.begin(async (transaction) => {
        await lockCorpusPublication(transaction);
        const replay = await readPublishedPublication(transaction, candidateId);
        if (replay) {
          return { ...replay, status: "published" as const };
        }
        const candidate = await readPublicationCandidate(transaction, candidateId);
        if (candidate.state === "rejected") {
          return readRejectedPublication(transaction, candidateId);
        }
        await assertCandidateEligible(transaction, candidate);
        const diagnosticCount = await validateCanonicalResults(transaction, candidateId);
        if (diagnosticCount > 0) {
          return rejectPublication(transaction, candidateId);
        }
        const changed = await materializeCanonicalResults(transaction, candidateId);

        const currentCorpusVersion = await readCorpusVersion(transaction);
        const corpusVersion = currentCorpusVersion + (changed ? 1 : 0);
        const publishedThroughDate = annualBaselineThroughDate;
        const completeThroughDate = annualBaselineThroughDate;
        const eventId = await finishPublication(transaction, {
          candidateId,
          changed,
          completeThroughDate,
          corpusVersion,
          publishedThroughDate,
        });
        return {
          changed,
          completeThroughDate,
          corpusVersion,
          eventId,
          publishedThroughDate,
          status: "published" as const,
        };
      });
    },
    stage() {
      return database.begin(async (transaction) => {
        await lockCorpusPublication(transaction);
        const reissues = await readArtifactVersionSelections(transaction);
        const unresolved = (await readUnresolvedLatestDiscoveries(transaction)).filter(
          isPublicationPolicyDiscovery
        );
        if (unresolved.length > 0) {
          return {
            artifacts: unresolved.map(({ filename, product }) => ({ filename, product })),
            reason: "unresolved-source-artifacts" as const,
            status: "ineligible" as const,
          };
        }
        const eligibleRows = policyEligibleRows(await readEligibleParseRuns(transaction));
        const complete = new Set(eligibleRows.map((row) => row.filename));
        const missingAnnualArtifacts = annualGenerationArtifactCount() - complete.size;
        if (missingAnnualArtifacts > 0) {
          return {
            missingAnnualArtifacts,
            reason: "incomplete-annual-generation" as const,
            status: "ineligible" as const,
          };
        }
        const groups = groupEligibleRows(eligibleRows);
        const requested = requestedReissues(reissues);
        assertRequestedArtifactsExist(groups, requested);
        const ambiguous = ambiguousGroups(groups, requested);
        if (ambiguous.length > 0) {
          return {
            artifacts: ambiguous.map(([first, ...versions]) => ({
              artifactVersionSha256s: versions
                .map((version) => version.artifactVersionSha256)
                .concat(first.artifactVersionSha256)
                .sort(),
              filename: first.filename,
              product: first.product,
            })),
            reason: "reissue-selection-required" as const,
            status: "ineligible" as const,
          };
        }
        const eligible = selectEligibleVersions(groups, requested);
        const identity = sourceFingerprint(eligible);
        const candidate = await stagePublicationCandidate(
          transaction,
          identity,
          publicationSemanticVersions,
          eligible
        );
        return {
          artifactCount: candidate.artifactCount,
          candidateId: candidate.candidateId,
          status: candidate.state,
        };
      });
    },
  };
}
