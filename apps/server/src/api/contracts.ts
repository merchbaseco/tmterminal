import type { ProjectedMark, SourceContributor } from "../ingestion/mark-types.ts";

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

export type MarkDetail = Omit<ProjectedMark, "contributors" | "kind" | "versions"> & {
  legalDisclaimer: typeof legalDisclaimer;
  provenance: {
    contributors: SourceContributor[];
    versions: ProjectedMark["versions"];
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
  bytes: number | null;
  completedAt: string | null;
  currentError: string | null;
  filename: string;
  physicalRecordCount: number;
  product: "TRTYRAP";
  projectedMarkCount: number;
  sha256: string | null;
  sourceFromDate: string;
  sourceToDate: string;
  state: "complete" | "downloading" | "failed" | "pending" | "projecting";
  updatedAt: string;
}

export interface OperatorPageInput {
  limit: number;
  offset: number;
}

export interface OperatorSyncStatus {
  generation: {
    activeGenerationId: string | null;
    completeArtifactCount: number;
    expectedArtifactCount: number;
    failedArtifactCount: number;
    projectedMarkCount: number;
  };
  provider: {
    currentError: string | null;
    failureCount: number;
    nextEligibleAt: string | null;
    status: "backoff" | "ready" | "stopped";
  };
  summary: SyncStatus;
}

export interface OperatorSyncService {
  artifacts: (input: OperatorPageInput) => Promise<BoundedPage<OperatorArtifact>>;
  status: () => Promise<OperatorSyncStatus>;
}
