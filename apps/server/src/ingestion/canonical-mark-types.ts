export const canonicalVersions = {
  authorityPolicy: "uspto-authority-v1",
  normalization: "uspto-normalization-v1",
  projection: "uspto-projection-v1",
  sourceProfile: "uspto-application-xml-v2.0-v1",
} as const;

export type Group =
  | "application"
  | "classes"
  | "goods-services"
  | "lifecycle"
  | "mark-presentation"
  | "owners"
  | "registration"
  | "status-events";

export type SourceCoordinate = {
  artifactVersionSha256: string;
  physicalRecordIndex: number;
  product: string;
};

export type Contributor = SourceCoordinate & { claimPath: string; group: Group };

export type CanonicalClass = {
  internationalCode: string | null;
  statusCode: string | null;
  statusDate: string | null;
};

export type CanonicalGoodsServices = {
  text: string | null;
  typeCode: string | null;
};

export type CanonicalOwner = {
  entryNumber: string | null;
  partyName: string | null;
  partyType: string | null;
};

export type CanonicalStatusEvent = {
  code: string | null;
  date: string | null;
  description: string | null;
  number: string | null;
  type: string | null;
};

export type ResolvedCanonicalMark = {
  classes: CanonicalClass[];
  contributors: Contributor[];
  goodsServices: CanonicalGoodsServices[];
  kind: "resolved";
  mark: {
    filingDate: string | null;
    markDrawingCode: string | null;
    registrationDate: string | null;
    registrationNumber: string | null;
    serialNumber: string;
    sourceTransactionDate: string | null;
    statusCode: string | null;
    statusDate: string | null;
    wordMark: string | null;
  };
  owners: CanonicalOwner[];
  statusEvents: CanonicalStatusEvent[];
  versions: typeof canonicalVersions;
};

export type UnsupportedSemantics = Contributor & {
  claimPath: string;
  group: Group;
  kind: "unsupported-semantics";
  operation: string | null;
  presence: string;
  profile: string;
  serialNumber: string;
};

export type AuthorityConflict = {
  claimPath: string;
  competingValues: unknown[];
  group: Group;
  kind: "authority-conflict";
  observations: SourceCoordinate[];
  policyVersion: typeof canonicalVersions.authorityPolicy;
  serialNumber: string;
};

export type CanonicalDiagnostic = AuthorityConflict | UnsupportedSemantics;

export type CanonicalizationResult =
  | ResolvedCanonicalMark
  | { diagnostics: CanonicalDiagnostic[]; kind: "unresolved"; versions: typeof canonicalVersions };
