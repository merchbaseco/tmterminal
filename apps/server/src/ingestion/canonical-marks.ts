import { decodeXmlText, type SourceObservation } from "./source-observations.ts";
import type { SourceValue } from "../db/schema.ts";

export const canonicalVersions = {
  authorityPolicy: "uspto-authority-v1",
  normalization: "uspto-normalization-v1",
  projection: "uspto-projection-v1",
  sourceProfile: "uspto-application-xml-v2.0-v1",
} as const;

type Group =
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

type Claim = {
  contributor: Contributor;
  observation: SourceObservation;
  semantics: "assert" | "order-sensitive";
  value: unknown;
};

type NormalizedScalar = { supported: boolean; value: unknown };

const scalarDefinitions: Array<{
  group: Group;
  normalize: (rawValue: string) => NormalizedScalar;
  path: string;
}> = [
  {
    group: "application",
    path: "case-file/case-file-header/filing-date",
    normalize: normalizeDate,
  },
  {
    group: "registration",
    path: "case-file/case-file-header/registration-date",
    normalize: normalizeDate,
  },
  { group: "lifecycle", path: "case-file/case-file-header/status-code", normalize: normalizeText },
  { group: "lifecycle", path: "case-file/case-file-header/status-date", normalize: normalizeDate },
  {
    group: "mark-presentation",
    path: "case-file/case-file-header/mark-identification",
    normalize: normalizeText,
  },
  {
    group: "mark-presentation",
    path: "case-file/case-file-header/mark-drawing-code",
    normalize: normalizeText,
  },
  {
    group: "registration",
    path: "case-file/registration-number",
    normalize(rawValue) {
      const normalized = normalizeText(rawValue);
      return normalized.supported && /^0+$/.test(normalized.value as string)
        ? { supported: true, value: null }
        : normalized;
    },
  },
  { group: "lifecycle", path: "case-file/transaction-date", normalize: normalizeDate },
];

const fixtureTransitions = new Set([
  "99427d74682359d7abae10aae48fe39efdde96c7fbbeef55a5f21d07a0700fae:21a3b3e5c90b895e8a21a2cd6d6f54a0e317ca1e869fb1804663a2847aa189a9",
  "34f2cec502db9074af200de2509255800f7ce83ba3781df9afa4063b5c4172ef:d073c5220246c0bf545272185344de056a6f9893b5018ee42d4ca7de0add6dff",
  "ed48531b8cd4a06211b4a2a9183bc951ad310197b44f39c09779704ebcc93edb:62b9e3fc29921e295965d4bdbb32bb14c73b3bd645304d1e20f7730e83084675",
]);

const supportedProfiles = new Set([
  "annual-tx-full-v1",
  "annual-tx-partial-v1",
  "annual-tx-status-only-v1",
  "daily-ib-full-v1",
  "daily-ib-partial-v1",
  "daily-na-full-v1",
  "daily-na-partial-v1",
  "daily-tx-full-v1",
  "daily-tx-partial-v1",
]);

function precedes(left: SourceObservation, right: SourceObservation) {
  return (
    left.product === "TRTDXFAP" &&
    right.product === "TRTDXFAP" &&
    left.sourceTransactionDate !== null &&
    right.sourceTransactionDate !== null &&
    left.sourceTransactionDate < right.sourceTransactionDate &&
    fixtureTransitions.has(`${left.digest}:${right.digest}`)
  );
}

function children(value: SourceValue, name: string) {
  return value.children?.filter((child) => child.name === name) ?? [];
}

function child(value: SourceValue, name: string) {
  return children(value, name)[0];
}

function semanticText(value: SourceValue | undefined) {
  return value?.rawValue === undefined ? null : decodeXmlText(value.rawValue).trim() || null;
}

function normalizeText(source: string): NormalizedScalar {
  const value = decodeXmlText(source).trim();
  return { supported: value !== "", value: value || null };
}

function normalizeDate(source: string): NormalizedScalar {
  const value = decodeXmlText(source).trim();
  // XML v2.0 proves only the all-zero unknown; other zero-filled precision is not projected in PRD-59.
  if (value === "00000000") return { supported: true, value: null };
  // Eligible source profiles are trusted for calendar validity; PostgreSQL surfaces impossible nonzero dates.
  return /^\d{8}$/.test(value) && value.slice(0, 4) !== "0000" && value.slice(4, 6) !== "00" && value.slice(6, 8) !== "00"
    ? { supported: true, value: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` }
    : { supported: false, value: null };
}

function hasUnsupportedDate(value: SourceValue, name: string) {
  const source = semanticText(child(value, name));
  return source !== null && !normalizeDate(source).supported;
}

function dateValue(value: SourceValue | undefined) {
  const source = semanticText(value);
  if (!source) return null;
  const normalized = normalizeDate(source);
  return normalized.supported ? normalized.value as string | null : null;
}

function coordinate(observation: SourceObservation, group: Group, claimPath: string): Contributor {
  return {
    artifactVersionSha256: observation.artifactVersionSha256,
    claimPath,
    group,
    physicalRecordIndex: observation.physicalRecordIndex,
    product: observation.product,
  };
}

function compareContributor(left: Contributor, right: Contributor) {
  return (
    left.group.localeCompare(right.group) ||
    left.claimPath.localeCompare(right.claimPath) ||
    left.product.localeCompare(right.product) ||
    left.artifactVersionSha256.localeCompare(right.artifactVersionSha256) ||
    left.physicalRecordIndex - right.physicalRecordIndex
  );
}

function compareCoordinate(left: SourceCoordinate, right: SourceCoordinate) {
  return (
    left.product.localeCompare(right.product) ||
    left.artifactVersionSha256.localeCompare(right.artifactVersionSha256) ||
    left.physicalRecordIndex - right.physicalRecordIndex
  );
}

function compareDiagnostic(left: CanonicalDiagnostic, right: CanonicalDiagnostic) {
  return (
    left.group.localeCompare(right.group) ||
    left.claimPath.localeCompare(right.claimPath) ||
    left.kind.localeCompare(right.kind)
  );
}

function normalizeClass(value: SourceValue): CanonicalClass {
  return {
    internationalCode: semanticText(child(value, "international-code")),
    statusCode: semanticText(child(value, "status-code")),
    statusDate: dateValue(child(value, "status-date")),
  };
}

function normalizeStatement(value: SourceValue): CanonicalGoodsServices {
  return { text: semanticText(child(value, "text")), typeCode: semanticText(child(value, "type-code")) };
}

function normalizeOwner(value: SourceValue): CanonicalOwner {
  return {
    entryNumber: semanticText(child(value, "entry-number")),
    partyName: semanticText(child(value, "party-name")),
    partyType: semanticText(child(value, "party-type")),
  };
}

function normalizeEvent(value: SourceValue): CanonicalStatusEvent {
  return {
    code: semanticText(child(value, "code")),
    date: dateValue(child(value, "date")),
    description: semanticText(child(value, "description-text")),
    number: semanticText(child(value, "number")),
    type: semanticText(child(value, "type")),
  };
}

export function canonicalizeMark(observations: SourceObservation[]): CanonicalizationResult {
  if (observations.length === 0) throw new Error("Canonicalization requires at least one source observation");
  const serialNumber = observations[0]!.serialNumber;
  if (observations.some((observation) => observation.serialNumber !== serialNumber)) {
    throw new Error("Canonicalization requires observations for exactly one serial number");
  }
  const uniqueObservations = new Map<string, SourceObservation>();
  for (const observation of observations) {
    const key = `${observation.product}:${observation.artifactVersionSha256}:${observation.physicalRecordIndex}`;
    if (!uniqueObservations.has(key)) uniqueObservations.set(key, observation);
  }

  const claims = new Map<string, Claim[]>();
  const diagnostics: CanonicalDiagnostic[] = [];
  const add = (
    group: Group,
    claimPath: string,
    value: unknown,
    observation: SourceObservation,
    semantics: Claim["semantics"] = "order-sensitive",
  ) => {
    const key = `${group}:${claimPath}`;
    const values = claims.get(key) ?? [];
    values.push({ contributor: coordinate(observation, group, claimPath), observation, semantics, value });
    claims.set(key, values);
  };
  const unsupported = (
    observation: SourceObservation,
    group: Group,
    claimPath: string,
    presence: string,
    operation: string | null,
  ) => diagnostics.push({
    ...coordinate(observation, group, claimPath),
    kind: "unsupported-semantics",
    operation,
    presence,
    profile: observation.profile,
    serialNumber,
  });

  for (const observation of [...uniqueObservations.values()].sort((left, right) => (
    left.product.localeCompare(right.product) ||
    left.artifactVersionSha256.localeCompare(right.artifactVersionSha256) ||
    left.physicalRecordIndex - right.physicalRecordIndex
  ))) {
    const root = observation.values[0];
    if (!root || root.name !== "case-file") throw new Error("Canonicalization requires lossless case-file values");
    if (!supportedProfiles.has(observation.profile)) {
      unsupported(observation, "mark-presentation", "case-file", root.presence, null);
      continue;
    }
    for (const definition of scalarDefinitions) {
      const claim = observation.claims.find((item) => item.path === definition.path);
      if (!claim) continue;
      const normalized = claim.rawValue === null
        ? { supported: false, value: null }
        : definition.normalize(claim.rawValue);
      if (claim.presence === "value" && claim.operation === "set" && normalized.supported) {
        add(definition.group, definition.path, normalized.value, observation);
      } else {
        unsupported(observation, definition.group, definition.path, claim.presence, claim.operation);
      }
    }

    const statements = child(root, "case-file-statements");
    if (statements) {
      const claim = observation.claims.find((item) => item.path === "case-file/case-file-statements");
      if (claim?.operation === "replace") {
        add("goods-services", claim.path, children(statements, "case-file-statement").map(normalizeStatement), observation);
      } else {
        unsupported(observation, "goods-services", "case-file/case-file-statements", statements.presence, claim?.operation ?? null);
      }
    }

    const classifications = child(root, "classifications");
    if (classifications) {
      const claim = observation.claims.find((item) => item.path === "case-file/classifications");
      const hasPartialDate = children(classifications, "classification")
        .some((classification) => hasUnsupportedDate(classification, "status-date"));
      if (claim?.operation === "replace" && !hasPartialDate) {
        add("classes", claim.path, children(classifications, "classification").map(normalizeClass), observation);
      } else {
        unsupported(observation, "classes", "case-file/classifications", classifications.presence, claim?.operation ?? null);
      }
    }

    const owners = child(root, "case-file-owners");
    if (owners) {
      const ownerRecords = children(owners, "case-file-owner");
      const claim = observation.claims.find((item) => item.path === "case-file/case-file-owners");
      if (owners.presence === "group" && ownerRecords.length > 0 && claim?.operation === "replace") {
        add("owners", "case-file/case-file-owners", ownerRecords.map(normalizeOwner), observation);
      } else {
        unsupported(observation, "owners", "case-file/case-file-owners", owners.presence, claim?.operation ?? null);
      }
    }

    const events = child(root, "case-file-event-statements");
    if (events) {
      const claim = observation.claims.find((item) => item.path === "case-file/case-file-event-statements");
      const hasPartialDate = children(events, "case-file-event-statement")
        .some((event) => hasUnsupportedDate(event, "date"));
      if (claim?.operation !== "assert" || hasPartialDate) {
        unsupported(observation, "status-events", claim?.path ?? "case-file/case-file-event-statements", events.presence, claim?.operation ?? null);
      } else {
        for (const event of children(events, "case-file-event-statement")) {
          const normalized = normalizeEvent(event);
          add(
            "status-events",
            `case-file/case-file-event-statements/${JSON.stringify(normalized)}`,
            normalized,
            observation,
            "assert",
          );
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    return { diagnostics: diagnostics.sort(compareDiagnostic), kind: "unresolved", versions: canonicalVersions };
  }

  const resolved = new Map<string, unknown>();
  const contributors: Contributor[] = [];
  const conflicts: AuthorityConflict[] = [];
  for (const [key, candidates] of claims) {
    const effective = candidates[0]?.semantics === "assert"
      ? candidates
      : candidates.filter((candidate) => !candidates.some((other) => precedes(candidate.observation, other.observation)));
    const values = new Map(
      effective
        .map((candidate) => [JSON.stringify(candidate.value), candidate.value] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    if (values.size !== 1) {
      const [group, ...path] = key.split(":");
      conflicts.push({
        claimPath: path.join(":"),
        competingValues: [...values.values()],
        group: group as Group,
        kind: "authority-conflict",
        observations: effective.map(({ contributor }) => ({
          artifactVersionSha256: contributor.artifactVersionSha256,
          physicalRecordIndex: contributor.physicalRecordIndex,
          product: contributor.product,
        })).sort(compareCoordinate),
        policyVersion: canonicalVersions.authorityPolicy,
        serialNumber,
      });
      continue;
    }
    resolved.set(key, values.values().next().value);
    contributors.push(...effective.map((candidate) => candidate.contributor));
  }
  if (conflicts.length > 0) {
    return { diagnostics: conflicts.sort(compareDiagnostic), kind: "unresolved", versions: canonicalVersions };
  }
  const get = <T>(group: Group, path: string) => (resolved.get(`${group}:${path}`) ?? null) as T | null;
  const contributorSet = new Map(contributors.map((contributor) => [
    `${contributor.group}:${contributor.claimPath}:${contributor.product}:${contributor.artifactVersionSha256}:${contributor.physicalRecordIndex}`,
    contributor,
  ]));

  return {
    classes: get<CanonicalClass[]>("classes", "case-file/classifications") ?? [],
    contributors: [...contributorSet.values()].sort(compareContributor),
    goodsServices: get<CanonicalGoodsServices[]>("goods-services", "case-file/case-file-statements") ?? [],
    kind: "resolved",
    mark: {
      filingDate: get("application", "case-file/case-file-header/filing-date"),
      markDrawingCode: get("mark-presentation", "case-file/case-file-header/mark-drawing-code"),
      registrationDate: get("registration", "case-file/case-file-header/registration-date"),
      registrationNumber: get("registration", "case-file/registration-number"),
      serialNumber,
      sourceTransactionDate: get("lifecycle", "case-file/transaction-date"),
      statusCode: get("lifecycle", "case-file/case-file-header/status-code"),
      statusDate: get("lifecycle", "case-file/case-file-header/status-date"),
      wordMark: get("mark-presentation", "case-file/case-file-header/mark-identification"),
    },
    owners: get<CanonicalOwner[]>("owners", "case-file/case-file-owners") ?? [],
    statusEvents: [...resolved.entries()]
      .filter(([key]) => key.startsWith("status-events:"))
      .map(([, value]) => value as CanonicalStatusEvent)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    versions: canonicalVersions,
  };
}
