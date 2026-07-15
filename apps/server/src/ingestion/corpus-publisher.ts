import { createHash } from "node:crypto";
import type postgres from "postgres";

import { annualGenerationV1Artifacts, annualGenerationV1MetadataSha256 } from "./annual-generation-v1.ts";
import {
  appendPublicationDiagnostics,
  finishPublication,
  readCorpusPublicationId,
  readCorpusVersion,
  readEligibleParseRuns,
  readPublicationObservations,
  readPublicationCandidate,
  readPublishedPublication,
  readRejectedPublication,
  readUnresolvedLatestDiscoveries,
  rejectPublication,
  stagePublicationCandidate,
  type EligibleParseRun,
} from "../queries/corpus-publication-repository.ts";
import { lockCorpusPublication } from "../queries/corpus-publication-lock.ts";
import { canonicalizeMark } from "./canonical-marks.ts";
import {
  canonicalVersions,
  type CanonicalDiagnostic,
  type CanonicalizationResult,
  type ResolvedCanonicalMark,
} from "./canonical-mark-types.ts";
import { sourceObservationParserVersion, type SourceObservation } from "./source-observations.ts";
import { publishCanonicalMarks } from "../queries/canonical-mark-repository.ts";

const annualGenerationArtifacts = new Set<string>(annualGenerationV1Artifacts);
const canonicalBatchSize = 250;
const publicationSemanticVersions = {
  authorityPolicy: canonicalVersions.authorityPolicy,
  normalization: canonicalVersions.normalization,
  parser: sourceObservationParserVersion,
  projection: canonicalVersions.projection,
  sourceProfile: canonicalVersions.sourceProfile,
} as const;

type CandidateIdentity = {
  artifactVersionSha256: string;
  discoveryId: string;
  filename: string;
  parseRunDigest: string;
  product: string;
  retainedVersionFingerprint: string;
  selectedExplicitly: boolean;
  sourceFromDate: string;
  sourceToDate: string;
};

function sourceFingerprint(artifacts: CandidateIdentity[]) {
  return createHash("sha256").update(JSON.stringify([
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
  ])).digest("hex");
}

function retainedVersionFingerprint(sha256s: string[]) {
  return createHash("sha256").update(JSON.stringify([...sha256s].sort())).digest("hex");
}

function candidateFingerprint(sourceIdentity: string, parentPublicationId: string | null) {
  return createHash("sha256").update(JSON.stringify([sourceIdentity, parentPublicationId])).digest("hex");
}

function isRelevantDiscovery(discovery: { filename: string; product: string }) {
  return discovery.product === "TRTDXFAP" || (
    discovery.product === "TRTYRAP" && annualGenerationArtifacts.has(discovery.filename)
  );
}

function policyEligibleRows(rows: EligibleParseRun[]) {
  return rows.filter((row) => row.product === "TRTDXFAP" || (
    row.product === "TRTYRAP" &&
    row.sourceFromDate === "1884-04-07" &&
    row.sourceToDate === "2025-12-31" &&
    annualGenerationArtifacts.has(row.filename)
  ));
}

async function* canonicalResults(
  database: postgres.Sql | postgres.TransactionSql,
  candidateId: string,
): AsyncGenerator<CanonicalizationResult> {
  let observations: SourceObservation[] = [];
  let serialNumber: string | null = null;
  for await (const observation of readPublicationObservations(database, candidateId)) {
    if (serialNumber !== null && observation.serialNumber !== serialNumber) {
      yield canonicalizeMark(observations);
      observations = [];
    }
    observations.push(observation);
    serialNumber = observation.serialNumber;
  }
  if (observations.length > 0) yield canonicalizeMark(observations);
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function completeFrontier(artifacts: Array<{ product: string; sourceFromDate: string; sourceToDate: string }>) {
  let frontier = "2025-12-31";
  const daily = artifacts.filter((artifact) => artifact.product === "TRTDXFAP").sort((left, right) => (
    `${left.sourceFromDate}\u0000${left.sourceToDate}`.localeCompare(`${right.sourceFromDate}\u0000${right.sourceToDate}`)
  ));
  for (const artifact of daily) {
    if (artifact.sourceToDate <= frontier) continue;
    if (artifact.sourceFromDate > nextDate(frontier)) break;
    if (artifact.sourceToDate > frontier) frontier = artifact.sourceToDate;
  }
  return frontier;
}

export function createCorpusPublisher(database: postgres.Sql) {
  return {
    async stage(options: {
      reissues?: Array<{ artifactVersionSha256: string; filename: string; product: string }>;
    } = {}) {
      return database.begin(async (transaction) => {
        await lockCorpusPublication(transaction);
        const unresolved = (await readUnresolvedLatestDiscoveries(transaction)).filter(isRelevantDiscovery);
        if (unresolved.length > 0) {
          return {
            artifacts: unresolved.map(({ filename, product }) => ({ filename, product })),
            reason: "unresolved-source-artifacts" as const,
            status: "ineligible" as const,
          };
        }
        const eligibleRows = policyEligibleRows(await readEligibleParseRuns(transaction));
        const annualRows = eligibleRows.filter((row) => row.product === "TRTYRAP");
        const complete = new Set(annualRows.map((row) => row.filename));
        const missingAnnualArtifacts = annualGenerationArtifacts.size - complete.size;
        if (missingAnnualArtifacts > 0) {
          return {
            missingAnnualArtifacts,
            reason: "incomplete-annual-generation" as const,
            status: "ineligible" as const,
          };
        }
        const byArtifact = new Map<string, typeof eligibleRows>();
        for (const row of eligibleRows) {
          const versions = byArtifact.get(row.artifactId) ?? [];
          versions.push(row);
          byArtifact.set(row.artifactId, versions);
        }
        const requested = new Map<string, string>();
        for (const selection of options.reissues ?? []) {
          const key = `${selection.product}\u0000${selection.filename}`;
          if (requested.has(key)) throw new Error(`Duplicate reissue selection: ${selection.product}/${selection.filename}`);
          requested.set(key, selection.artifactVersionSha256);
        }
        const eligibleKeys = new Set([...byArtifact.values()].map((versions) => (
          `${versions[0]!.product}\u0000${versions[0]!.filename}`
        )));
        for (const key of requested.keys()) {
          if (!eligibleKeys.has(key)) throw new Error(`Selected reissue artifact is not eligible: ${key.replace("\u0000", "/")}`);
        }
        const ambiguous = [...byArtifact.values()].filter((versions) => (
          versions[0]!.retainedVersionCount > 1 &&
          !requested.has(`${versions[0]!.product}\u0000${versions[0]!.filename}`)
        ));
        if (ambiguous.length > 0) {
          return {
            artifacts: ambiguous.map((versions) => ({
              artifactVersionSha256s: versions.map((version) => version.artifactVersionSha256).sort(),
              filename: versions[0]!.filename,
              product: versions[0]!.product,
            })),
            reason: "reissue-selection-required" as const,
            status: "ineligible" as const,
          };
        }
        const eligible = [...byArtifact.values()].map((versions) => {
          const selectedSha256 = requested.get(`${versions[0]!.product}\u0000${versions[0]!.filename}`);
          const selected = selectedSha256
            ? versions.find((version) => version.artifactVersionSha256 === selectedSha256)
            : versions[0];
          if (!selected) {
            throw new Error(`Selected reissue is not retained: ${versions[0]!.product}/${versions[0]!.filename}`);
          }
          return {
            ...selected,
            retainedVersionFingerprint: retainedVersionFingerprint(selected.retainedVersionSha256s),
            selectedExplicitly: selectedSha256 !== undefined && selected.retainedVersionCount > 1,
          };
        }).sort((left, right) => (
          `${left.product}\u0000${left.filename}`.localeCompare(`${right.product}\u0000${right.filename}`)
        ));
        const identity = sourceFingerprint(eligible);
        const candidate = await stagePublicationCandidate(transaction, identity, publicationSemanticVersions, eligible);
        return {
          artifactCount: candidate.artifactCount,
          candidateId: candidate.candidateId,
          status: candidate.state,
        };
      });
    },

    async publish(candidateId: string) {
      return database.begin(async (transaction) => {
        await lockCorpusPublication(transaction);
        const replay = await readPublishedPublication(transaction, candidateId);
        if (replay) return { ...replay, status: "published" as const };
        const candidate = await readPublicationCandidate(transaction, candidateId);
        if (candidate.state === "rejected") return readRejectedPublication(transaction, candidateId);
        if (candidate.state !== "staged") throw new Error(`Publication candidate is ${candidate.state}`);
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
          candidate.fingerprint !== candidateFingerprint(currentSourceFingerprint, candidate.parentPublicationId)
        ) {
          throw new Error("Publication candidate identity changed");
        }
        if (await readCorpusPublicationId(transaction) !== candidate.parentPublicationId) {
          throw new Error("Publication candidate parent changed");
        }
        if ((await readUnresolvedLatestDiscoveries(transaction)).some(isRelevantDiscovery)) {
          throw new Error("Publication candidate source discovery is unresolved");
        }
        const eligibleArtifactIds = new Set(
          policyEligibleRows(await readEligibleParseRuns(transaction)).map((artifact) => artifact.artifactId),
        );
        const candidateArtifactIds = new Set(candidate.artifacts.map((artifact) => artifact.artifactId));
        if (
          eligibleArtifactIds.size !== candidateArtifactIds.size ||
          [...eligibleArtifactIds].some((artifactId) => !candidateArtifactIds.has(artifactId))
        ) {
          throw new Error("Publication candidate complete eligible source set changed");
        }
        for (const artifact of candidate.artifacts) {
          if (
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
            artifact.retainedVersionFingerprint !== retainedVersionFingerprint(artifact.retainedVersionSha256s) ||
            (!artifact.selectedExplicitly && artifact.retainedVersionCount !== 1)
          ) {
            throw new Error("Publication candidate eligibility changed");
          }
        }
        const annual = new Set(candidate.artifacts.filter((artifact) => (
          artifact.product === "TRTYRAP" &&
          artifact.sourceFromDate === "1884-04-07" &&
          artifact.sourceToDate === "2025-12-31" &&
          annualGenerationArtifacts.has(artifact.filename)
        )).map((artifact) => artifact.filename));
        if (annual.size !== annualGenerationArtifacts.size) {
          throw new Error("Pinned annual generation became incomplete");
        }

        let diagnosticCount = 0;
        let diagnosticBatch: CanonicalDiagnostic[] = [];
        for await (const result of canonicalResults(transaction, candidateId)) {
          if (result.kind === "resolved") continue;
          diagnosticCount += result.diagnostics.length;
          diagnosticBatch.push(...result.diagnostics);
          if (diagnosticBatch.length >= canonicalBatchSize) {
            await appendPublicationDiagnostics(transaction, candidateId, diagnosticBatch);
            diagnosticBatch = [];
          }
        }
        await appendPublicationDiagnostics(transaction, candidateId, diagnosticBatch);
        if (diagnosticCount > 0) return rejectPublication(transaction, candidateId);

        let changed = false;
        let materializations: ResolvedCanonicalMark[] = [];
        for await (const result of canonicalResults(transaction, candidateId)) {
          if (result.kind !== "resolved") throw new Error("Publication validation changed inside transaction");
          materializations.push(result);
          if (materializations.length >= canonicalBatchSize) {
            changed = await publishCanonicalMarks(transaction, materializations) || changed;
            materializations = [];
          }
        }
        changed = await publishCanonicalMarks(transaction, materializations) || changed;

        const currentCorpusVersion = await readCorpusVersion(transaction);
        const corpusVersion = currentCorpusVersion + (changed ? 1 : 0);
        const publishedThroughDate = candidate.artifacts
          .map((artifact) => artifact.sourceToDate)
          .sort()
          .at(-1)!;
        const completeThroughDate = completeFrontier(candidate.artifacts);
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
  };
}
