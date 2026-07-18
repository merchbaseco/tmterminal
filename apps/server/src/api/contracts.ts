import type { ProjectedMark, SourceContributor } from "../ingestion/mark-types.ts";
import type { MarkStatus } from "../search/status-policy.ts";

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

export type MarkDetail = Omit<ProjectedMark, "contributors" | "kind" | "mark" | "versions"> & {
  legalDisclaimer: typeof legalDisclaimer;
  mark: ProjectedMark["mark"] & { status: MarkStatus };
  provenance: {
    contributors: SourceContributor[];
    versions: ProjectedMark["versions"];
  };
};

interface SearchInputBase {
  expectedDataVersion?: string;
  limit: 25;
  offset: number;
  query: string;
  registered: "all" | "yes" | "no";
  sort: "relevance" | "newest-activity" | "oldest-activity";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "typeset" | "text" | "other";
}

export type SearchInput = SearchInputBase &
  (
    | { match: "exact" | "partial" | "both"; mode: "multi" }
    | { match?: never; mode: "split" }
    | { match?: never; mode: "wildcard" }
  );

export interface SearchPage {
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
  liveMatchCounts: {
    exact: number;
    partial: number;
  };
  meta: {
    dataThroughDate: string | null;
    dataVersion: string;
  };
  offset: number;
  total: number;
}

export interface MarksService {
  getByRegistrationNumber: (registrationNumber: string) => Promise<MarkDetail | null>;
  getBySerialNumber: (serialNumber: string) => Promise<MarkDetail | null>;
  search: (input: SearchInput) => Promise<SearchPage>;
}

export interface ReportInput {
  event: "filed" | "published-for-opposition" | "registered";
  expectedDataVersion?: string;
  expectedFrom?: string;
  expectedTo?: string;
  limit: 25;
  offset: number;
  registered: "all" | "yes" | "no";
  sort: "newest-activity" | "oldest-activity";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "typeset" | "text" | "other";
  window?: "previous-week";
}

export interface ReportPage extends Omit<SearchPage, "items" | "liveMatchCounts"> {
  from: string | null;
  items: Omit<SearchPage["items"][number], "match">[];
  to: string | null;
}

export interface ReportsService {
  run: (input: ReportInput) => Promise<ReportPage>;
}

export interface SyncStatus {
  activeState: "backoff" | "downloading" | "failed" | "idle" | "parsing" | "stopped";
  completeThroughDate: string | null;
  dataVersion: number;
  degraded: boolean;
  degradedSince: string | null;
  failedCount: number;
  lastSuccessfulUpdateAt: string | null;
  pendingCount: number;
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
  product: "TRTDXFAP" | "TRTYRAP";
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
  annualBaseline: {
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
  source: {
    lastActivityAt: string | null;
    physicalRecordCount: number;
    projectedMarkCount: number;
  };
  summary: SyncStatus;
}

export interface OperatorSyncService {
  artifacts: (input: OperatorPageInput) => Promise<BoundedPage<OperatorArtifact>>;
  status: () => Promise<OperatorSyncStatus>;
}
