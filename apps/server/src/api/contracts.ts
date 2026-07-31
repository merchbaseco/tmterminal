import type { SearchPreferences } from "../account-preferences.ts";
import type { MarkType, ProjectedMark, SourceContributor } from "../ingestion/mark-types.ts";

export const legalDisclaimer =
  "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.";

export interface AuthenticatedAccount {
  accountId: string;
  credential: { type: "api-key" | "oauth" | "session" };
}

export interface AccountService {
  getSearchPreferences: () => Promise<SearchPreferences>;
  updateSearchPreferences: (preferences: SearchPreferences) => Promise<SearchPreferences>;
}

export type MarkDetail = Omit<ProjectedMark, "contributors" | "kind" | "mark" | "versions"> & {
  legalDisclaimer: typeof legalDisclaimer;
  mark: ProjectedMark["mark"] & { status: "dead" | "live" | "unknown" };
  provenance: {
    contributors: SourceContributor[];
    versions: ProjectedMark["versions"];
  };
  type: MarkType;
};

export type SearchPageSize = 25 | 50 | 100;

interface SearchInputBase {
  expectedDataVersion?: string;
  limit: SearchPageSize;
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

export interface MarkSummary {
  goodsServicesExcerpt: string | null;
  internationalClasses: string[];
  owner: string | null;
  registrationNumber: string | null;
  serialNumber: string;
  sourceTransactionDate: string | null;
  status: "live" | "dead" | "unknown";
  statusDate: string | null;
  type: MarkType;
  wordMark: string;
}

export interface MarkPage {
  items: MarkSummary[];
  limit: 25;
  meta: {
    dataVersion: string;
  };
  offset: number;
  total: number;
}

export interface SearchPage extends Omit<MarkPage, "items" | "limit"> {
  items: Array<MarkSummary & { match: "exact" | "partial" }>;
  limit: SearchPageSize;
  liveMatchCounts: {
    exact: number;
    partial: number;
  };
}

export interface ListMarksInput {
  expectedDataVersion?: string;
  limit: 25;
  offset: number;
}

export interface MatchTextsInput {
  texts: Array<{
    id: string;
    text: string;
  }>;
  type: "all" | "design" | "typeset" | "text" | "other";
}

export interface MatchTextsResult {
  meta: MarkPage["meta"];
  texts: Array<{
    id: string;
    matches: Array<{
      end: number;
      start: number;
      trademarks: MarkSummary[];
    }>;
    text: string;
  }>;
}

export interface ScreenQueriesInput {
  queries: Array<{
    id: string;
    query: string;
  }>;
  type: "all" | "design" | "typeset" | "text" | "other";
}

export interface ScreenQueriesResult {
  meta: MarkPage["meta"];
  queries: Array<{
    id: string;
    liveMatches: {
      exact: number;
      partial: number;
    };
    query: string;
  }>;
}

export interface MarksService {
  get: (
    identity: { registrationNumber: string } | { serialNumber: string }
  ) => Promise<MarkDetail | null>;
  list: (input: ListMarksInput) => Promise<MarkPage>;
  match: (input: MatchTextsInput) => Promise<MatchTextsResult>;
  screen: (input: ScreenQueriesInput) => Promise<ScreenQueriesResult>;
  search: (input: SearchInput) => Promise<SearchPage>;
}

export interface SyncStatus {
  activeState: "applying" | "discovering" | "downloading" | "failed" | "idle";
  dataVersion: number;
  failedCount: number;
  lastSuccessfulUpdateAt: string | null;
  latestProcessedDate: string | null;
  pendingCount: number;
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
  applicationCompletedAt: string | null;
  applicationState: "applying" | "complete" | "needs_attention" | "pending";
  appliedRecordCount: number;
  artifactId: string;
  bytes: number | null;
  currentError: string | null;
  downloadedAt: string | null;
  downloadResponseState: {
    contentLength?: string;
    contentType?: string;
    etag?: string;
    observedAt?: string;
    providerRequestCount?: number;
    rateLimitReset?: string;
    requestId?: string;
    retryAfter?: string;
    retryAfterSeconds?: number;
    retryNotBefore?: string;
    status: number;
  } | null;
  downloadState: "blocked" | "downloaded" | "downloading" | "pending";
  filename: string;
  parserVersion: string | null;
  physicalRecordCount: number;
  processingDisposition: "covered" | "deferred" | "required";
  product: "TRTDXFAP" | "TRTYRAP";
  projectedMarkCount: number;
  sha256: string | null;
  sourceFromDate: string;
  sourceToDate: string;
  storageState: "cleaned-up" | "not-downloaded" | "retained";
  unresolvedRecordCount: number;
  updatedAt: string;
}

export interface OperatorPageInput {
  filter?: "all" | "needs-attention";
  limit: number;
  offset: number;
}

export interface OperatorArtifactPage extends BoundedPage<OperatorArtifact> {
  counts: {
    all: number;
    needsAttention: number;
  };
}

export interface PublicSourceStatus {
  catalog: {
    earliestFilingDate: string | null;
    totalMarkCount: number;
  };
  source: {
    applicationActivity: Array<{
      applicationUpdates: number;
      date: string;
      newApplications: number;
    }>;
    currentArtifact: {
      filename: string;
      state: "applying" | "discovering" | "downloading";
    } | null;
    lastActivityAt: string | null;
    latestProcessedDate: string | null;
  };
}

export interface OperatorSyncStatus extends PublicSourceStatus {
  attention: {
    items: Array<{
      artifactId: string;
      filename: string;
      httpStatus: number | null;
      message: string | null;
      providerRequestCount: number | null;
      retryNotBefore: string | null;
      stage: "application" | "download" | "worker";
      updatedAt: string;
    }>;
    total: number;
  };
}

export interface OperatorSyncService {
  artifacts: (input: OperatorPageInput) => Promise<OperatorArtifactPage>;
  publicStatus: () => Promise<PublicSourceStatus>;
  status: () => Promise<OperatorSyncStatus>;
}
