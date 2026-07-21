export const markVersions = {
  authorityPolicy: "uspto-authority-v1",
  normalization: "uspto-normalization-v1",
  projection: "uspto-projection-v2",
  sourceProfile: "uspto-application-xml-v2.0-v1",
} as const;

export type MarkVersions = Omit<typeof markVersions, "projection"> & { projection: string };

export interface SourceContributor {
  artifactVersionSha256: string;
  claimPath: string;
  group: "mark-presentation";
  physicalRecordIndex: number;
  product: string;
}

export interface MarkClass {
  internationalCode: string | null;
  statusCode: string | null;
  statusDate: string | null;
}

export interface MarkGoodsServices {
  text: string | null;
  typeCode: string | null;
}

export interface MarkOwner {
  entryNumber: string | null;
  partyName: string | null;
  partyType: string | null;
}

export interface MarkStatusEvent {
  code: string | null;
  date: string | null;
  description: string | null;
  number: string | null;
  type: string | null;
}

export interface ProjectedMark {
  classes: MarkClass[];
  contributors: SourceContributor[];
  goodsServices: MarkGoodsServices[];
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
  owners: MarkOwner[];
  statusEvents: MarkStatusEvent[];
  versions: MarkVersions;
}
