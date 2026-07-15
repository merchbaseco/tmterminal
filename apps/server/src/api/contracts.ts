import type {
  Contributor,
  ResolvedCanonicalMark,
} from "../ingestion/canonical-mark-types.ts";

export const legalDisclaimer =
  "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.";

export type AuthenticatedAccount = {
  accountId: string;
  credential: { type: "api-key"; keyId: string; suffix: string } | { type: "clerk" };
};

export type PublicApiKey = {
  createdAt: string;
  id: string;
  lastUsedAt: string | null;
  name: string;
  status: "active" | "revoked";
  suffix: string;
};

export type AccountService = {
  createApiKey(name: string): Promise<{ key: PublicApiKey; token: string }>;
  listApiKeys(): Promise<PublicApiKey[]>;
  revokeApiKey(id: string): Promise<PublicApiKey | null>;
};

export type MarkDetail = Omit<ResolvedCanonicalMark, "contributors" | "kind" | "versions"> & {
  legalDisclaimer: typeof legalDisclaimer;
  provenance: {
    contributors: Contributor[];
    versions: ResolvedCanonicalMark["versions"];
  };
};

export type MarksService = {
  getByRegistrationNumber(registrationNumber: string): Promise<MarkDetail | null>;
  getBySerialNumber(serialNumber: string): Promise<MarkDetail | null>;
};
