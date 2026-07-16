import type { Contributor, ResolvedCanonicalMark } from "../ingestion/canonical-mark-types.ts";

export const legalDisclaimer =
  "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.";

export interface AuthenticatedAccount {
  accountId: string;
  credential: { type: "api-key"; keyId: string; suffix: string } | { type: "clerk" };
}

export interface PublicApiKey {
  createdAt: string;
  id: string;
  lastUsedAt: string | null;
  name: string;
  status: "active" | "revoked";
  suffix: string;
}

export interface AccountService {
  createApiKey: (name: string) => Promise<{ key: PublicApiKey; token: string }>;
  listApiKeys: () => Promise<PublicApiKey[]>;
  revokeApiKey: (id: string) => Promise<PublicApiKey | null>;
}

export type MarkDetail = Omit<ResolvedCanonicalMark, "contributors" | "kind" | "versions"> & {
  legalDisclaimer: typeof legalDisclaimer;
  provenance: {
    contributors: Contributor[];
    versions: ResolvedCanonicalMark["versions"];
  };
};

export interface MultiSearchInput {
  expectedCorpusVersion?: string;
  limit: 25;
  match: "exact" | "partial" | "both";
  mode: "multi";
  offset: number;
  query: string;
  registered: "all" | "yes" | "no";
  sort: "relevance" | "newest-activity" | "oldest-activity";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "typeset" | "text" | "other";
}

export interface MultiSearchPage {
  items: Array<{
    goodsServicesExcerpt: string | null;
    internationalClasses: string[];
    match: "exact" | "partial";
    owner: string | null;
    registrationNumber: string | null;
    serialNumber: string;
    sourceTransactionDate: string | null;
    status: "live" | "dead" | "unknown";
    statusDate: string | null;
    type: "design" | "typeset" | "text" | "other";
    wordMark: string;
  }>;
  limit: 25;
  meta: {
    corpusThroughDate: string;
    corpusVersion: string;
  };
  offset: number;
  total: number;
}

export interface MarksService {
  getByRegistrationNumber: (registrationNumber: string) => Promise<MarkDetail | null>;
  getBySerialNumber: (serialNumber: string) => Promise<MarkDetail | null>;
  search: (input: MultiSearchInput) => Promise<MultiSearchPage>;
}

export interface SyncStatus {
  activeState:
    | "backoff"
    | "discovering"
    | "downloading"
    | "failed"
    | "idle"
    | "operator-action-required"
    | "parsing"
    | "publishing"
    | "stopped";
  completeThroughDate: string | null;
  corpusVersion: number;
  degraded: boolean;
  degradedSince: string | null;
  failedCount: number;
  lastSuccessfulMergeAt: string | null;
  pendingCount: number;
  publishedThroughDate: string | null;
  quarantineCount: number;
  reissueSelectionRequiredCount: number;
  rejectCount: number;
  stale: boolean;
  staleSince: string | null;
}

export interface SyncService {
  status: () => Promise<SyncStatus>;
}

export interface BoundedPage<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface OperatorArtifact {
  artifactId: string;
  artifactVersionId: string | null;
  bytes: number | null;
  filename: string;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  observedAt: string;
  parseRunId: string | null;
  product: "TRTDXFAP" | "TRTYRAP";
  quarantineReason: string | null;
  retainedVersionCount: number;
  selectedArtifactVersionId: string | null;
  selectedSha256: string | null;
  selectionRequired: boolean;
  sha256: string | null;
  sourceFromDate: string;
  sourceToDate: string;
  stage:
    | "downloading"
    | "parsing"
    | "pending"
    | "published"
    | "quarantined"
    | "staged"
    | "verified";
  stageSince: string;
}

export interface OperatorPageInput {
  limit: number;
  offset: number;
  product?: "TRTDXFAP" | "TRTYRAP";
}

export interface OperatorArtifactVersion {
  artifactId: string;
  artifactVersionId: string;
  bytes: number;
  createdAt: string;
  filename: string;
  observedAt: string | null;
  parserVersion: string | null;
  parseState: "parsing" | "quarantined" | "staged" | null;
  product: "TRTDXFAP" | "TRTYRAP";
  quarantineReason: string | null;
  selected: boolean;
  sha256: string;
  sourceFromDate: string | null;
  sourceToDate: string | null;
  state: "parsing" | "published" | "quarantined" | "staged" | "verified";
}

export interface OperatorPublication {
  artifactCount: number;
  completeThroughDate: string | null;
  corpusVersion: number | null;
  createdAt: string;
  diagnosticCount: number;
  id: string;
  parentPublicationId: string | null;
  publishedAt: string | null;
  publishedThroughDate: string | null;
  rejectedAt: string | null;
  state: "published" | "rejected" | "staged";
}

export interface OperatorRejection {
  artifactVersionSha256: string | null;
  bytes: number | null;
  claimPath: string | null;
  createdAt: string;
  diagnostic: Record<string, unknown> | null;
  digest: string | null;
  filename: string | null;
  group: string | null;
  id: string;
  kind: "authority-conflict" | "parse-reject" | "unsupported-semantics";
  parseRunId: string | null;
  physicalRecordIndex: number | null;
  product: "TRTDXFAP" | "TRTYRAP" | null;
  publicationId: string | null;
  reason: string;
  serialNumber: string | null;
}

export interface OperatorDatasetStatus {
  backlogCount: number;
  completeThroughDate: string | null;
  coverageFromDate: string | null;
  coverageThroughDate: string | null;
  currentStage: SyncStatus["activeState"] | "pending" | "quarantined" | "rejected";
  failedCount: number;
  latestPublicationAt: string | null;
  latestSuccessfulActivityAt: string | null;
  product: "TRTDXFAP" | "TRTYRAP";
  providerBackoffUntil: string | null;
  providerStopReason: string | null;
  publicationParsedArtifactCount: number;
  publicationPolicy: "annual-baseline" | "retained-only";
  publicationTargetArtifactCount: number;
  quarantineCount: number;
  reason: string | null;
  rejectCount: number;
  stageSince: string | null;
}

export interface OperatorSyncStatus {
  datasets: OperatorDatasetStatus[];
  summary: SyncStatus;
}

export interface OperatorSyncService {
  artifacts: (input: OperatorPageInput) => Promise<BoundedPage<OperatorArtifact>>;
  artifactVersions: (input: OperatorPageInput) => Promise<BoundedPage<OperatorArtifactVersion>>;
  publications: (
    input: Omit<OperatorPageInput, "product">
  ) => Promise<BoundedPage<OperatorPublication>>;
  rejects: (input: OperatorPageInput) => Promise<BoundedPage<OperatorRejection>>;
  status: () => Promise<OperatorSyncStatus>;
}
