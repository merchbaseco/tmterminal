import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

import type { SourceValue } from "../db/schema.ts";
import { lockCorpusPublication } from "../queries/corpus-publication-lock.ts";

export const sourceObservationParserVersion = "uspto-application-xml-v4";
const recordStart = Buffer.from("<case-file>");
const recordEnd = Buffer.from("</case-file>");
const recordBatchSize = 100;
const inputSliceBytes = 64 * 1024;
const maxOuterTokenBytes = 64 * 1024;
const maxRecordBytes = 4 * 1024 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const xmlEntityPattern = /^&(amp|apos|gt|lt|quot|#\d+|#x[\da-fA-F]+);/;
const recordTokenPattern = /<\/?[a-z0-9-]+>|<[a-z0-9-]+\s*\/>|[^<]+/g;
const selfClosingPattern = /\s*\/>$/;
const openingElementPattern = /^<([a-z0-9-]+)/;
const compactDatePattern = /^\d{8}$/;
const outerTokensPattern = /<[^>]*>|[^<]+/g;
const outerElementPattern = /^<(\/)?([a-z][a-z0-9-]*)>$/;
const digitsPattern = /^\d+$/;

type ClaimOperation = "assert" | "clear" | "replace" | "set" | null;

export interface SourceClaim {
  occurrence: number;
  operation: ClaimOperation;
  path: string;
  presence: SourceValue["presence"];
  rawValue: string | null;
}

export interface SourceObservation {
  actionKey: string;
  actionOccurrence: number;
  actionRecordIndex: number;
  artifactVersionSha256: string;
  claims: SourceClaim[];
  digest: string;
  physicalRecordIndex: number;
  product: string;
  profile: string;
  schemaVersion: string;
  schemaVersionDate: string;
  serialNumber: string;
  sourceTransactionDate: string | null;
  sourceTransactionDateRaw: string | null;
  values: SourceValue[];
}

export interface ParseResult {
  digest: string;
  parseRunId: string;
  recordCount: number;
  rejectCount: number;
  status: "quarantined" | "staged";
}

export interface SourceReject {
  bytes: number;
  digest: string;
  physicalRecordIndex: number | null;
  rawXml: Buffer;
  reason: string;
}

interface ParseRunRow {
  digest: string | null;
  parseRunId: string | null;
  recordCount: number | null;
  rejectCount: number | null;
  state: "parsing" | "quarantined" | "staged" | null;
}

function terminalParseResult(run: ParseRunRow): ParseResult | null {
  if (run.state !== "staged" && run.state !== "quarantined") {
    return null;
  }
  if (!(run.parseRunId && run.digest) || run.recordCount === null || run.rejectCount === null) {
    throw new Error("Terminal parse run is incomplete");
  }
  return {
    digest: run.digest,
    parseRunId: run.parseRunId,
    recordCount: run.recordCount,
    rejectCount: run.rejectCount,
    status: run.state,
  };
}

interface StageInput {
  artifactVersionId: string;
  xml: ReadableStream<Uint8Array>;
}

class ParseFailure extends Error {
  readonly physicalRecordIndex: number | null;
  readonly rawXml: Buffer;
  readonly reason: string;

  constructor(
    reason: string,
    rawXml: Buffer,
    physicalRecordIndex: number | null = null,
    options?: ErrorOptions
  ) {
    super(reason, options);
    this.physicalRecordIndex = physicalRecordIndex;
    this.rawXml = rawXml;
    this.reason = reason;
  }
}

interface XmlNode {
  children: XmlNode[];
  name: string;
  rawValue: string;
}
const scalarClaimPaths = new Set([
  "case-file/registration-number",
  "case-file/transaction-date",
  "case-file/case-file-header/filing-date",
  "case-file/case-file-header/registration-date",
  "case-file/case-file-header/status-code",
  "case-file/case-file-header/status-date",
  "case-file/case-file-header/mark-identification",
  "case-file/case-file-header/mark-drawing-code",
]);

function decodeUtf8(raw: Buffer) {
  try {
    return utf8Decoder.decode(raw);
  } catch (cause) {
    const failure = new ParseFailure("invalid UTF-8", raw, null, { cause });
    throw failure;
  }
}

function validXmlCodePoint(codePoint: number) {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7_ff) ||
    (codePoint >= 0xe0_00 && codePoint <= 0xff_fd) ||
    (codePoint >= 0x1_00_00 && codePoint <= 0x10_ff_ff)
  );
}

export function decodeXmlText(text: string) {
  let decoded = "";
  let offset = 0;
  for (;;) {
    const entityOffset = text.indexOf("&", offset);
    if (entityOffset < 0) {
      return decoded + text.slice(offset);
    }
    decoded += text.slice(offset, entityOffset);
    const reference = text.slice(entityOffset).match(xmlEntityPattern);
    if (!reference) {
      throw new Error("invalid XML entity");
    }
    const [, value] = reference;
    if (!value) {
      throw new Error("invalid XML entity");
    }
    if (value.startsWith("#")) {
      const codePoint = value.startsWith("#x")
        ? Number.parseInt(value.slice(2), 16)
        : Number.parseInt(value.slice(1), 10);
      if (!validXmlCodePoint(codePoint)) {
        throw new Error("invalid XML entity");
      }
      decoded += String.fromCodePoint(codePoint);
    } else {
      decoded += { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' }[
        value as "amp" | "apos" | "gt" | "lt" | "quot"
      ];
    }
    offset = entityOffset + reference[0].length;
  }
}

function validateXmlCharacters(text: string, raw: Buffer) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !validXmlCodePoint(codePoint)) {
      throw new ParseFailure("invalid XML character", raw);
    }
  }
}

function validateXmlEntities(text: string, raw: Buffer) {
  try {
    decodeXmlText(text);
  } catch (cause) {
    const failure = new ParseFailure("invalid XML entity", raw, null, { cause });
    throw failure;
  }
}

function closeRecordElement(token: string, stack: XmlNode[], raw: Buffer) {
  const name = token.slice(2, -1);
  const node = stack.pop();
  if (!node || node.name !== name) {
    throw new ParseFailure("malformed XML", raw);
  }
}

function openRecordElement(token: string, roots: XmlNode[], stack: XmlNode[], raw: Buffer) {
  const selfClosing = selfClosingPattern.test(token);
  const name = token.match(openingElementPattern)?.[1];
  if (!name) {
    throw new ParseFailure("unsupported XML construct", raw);
  }
  const node: XmlNode = { children: [], name, rawValue: "" };
  const parent = stack.at(-1);
  if (parent) {
    parent.children.push(node);
  } else {
    roots.push(node);
  }
  if (!selfClosing) {
    stack.push(node);
  }
}

function appendRecordText(token: string, stack: XmlNode[], raw: Buffer) {
  validateXmlCharacters(token, raw);
  const node = stack.at(-1);
  if (!node) {
    if (token.trim() !== "") {
      throw new ParseFailure("text outside case-file", raw);
    }
    return;
  }
  if (node.children.length > 0) {
    if (token.trim() !== "") {
      throw new ParseFailure("mixed XML content is unsupported", raw);
    }
    return;
  }
  validateXmlEntities(token, raw);
  node.rawValue += token;
}

function parseRecord(raw: Buffer) {
  const xml = decodeUtf8(raw);
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  let offset = 0;
  for (const match of xml.matchAll(recordTokenPattern)) {
    if (match.index !== offset) {
      throw new ParseFailure("malformed XML", raw);
    }
    const [token] = match;
    offset += token.length;
    if (token.startsWith("</")) {
      closeRecordElement(token, stack, raw);
      continue;
    }
    if (token.startsWith("<")) {
      openRecordElement(token, roots, stack, raw);
      continue;
    }
    appendRecordText(token, stack, raw);
  }
  if (
    offset !== xml.length ||
    stack.length !== 0 ||
    roots.length !== 1 ||
    roots[0]?.name !== "case-file"
  ) {
    throw new ParseFailure("malformed XML", raw);
  }
  return roots[0];
}

function toSourceValue(node: XmlNode): SourceValue {
  if (node.children.length > 0) {
    return { children: node.children.map(toSourceValue), name: node.name, presence: "group" };
  }
  return node.rawValue === ""
    ? { name: node.name, presence: "empty", rawValue: "" }
    : { name: node.name, presence: "value", rawValue: node.rawValue };
}

function direct(node: XmlNode, name: string) {
  return node.children.filter((child) => child.name === name);
}

function scalar(node: XmlNode, name: string, raw: Buffer) {
  const matches = direct(node, name);
  if (matches.length > 1) {
    throw new ParseFailure(`ambiguous ${name}`, raw);
  }
  const [match] = matches;
  if (!match || match.children.length > 0) {
    return null;
  }
  return match.rawValue;
}

function profileRecord(root: XmlNode, productId: string, actionKey: string) {
  const annual = productId === "TRTYRAP" && actionKey === "TX";
  const daily =
    productId === "TRTDXFAP" && (actionKey === "IB" || actionKey === "NA" || actionKey === "TX");
  if (!(annual || daily)) {
    return null;
  }
  const headers = direct(root, "case-file-header");
  if (headers.length !== 1) {
    return null;
  }
  const [header] = headers;
  if (!header) {
    return null;
  }
  const groupCounts = [
    direct(header, "mark-identification").length,
    direct(root, "case-file-statements").length,
    direct(root, "classifications").length,
    direct(root, "case-file-owners").length,
  ];
  if (groupCounts.some((count) => count > 1)) {
    return null;
  }
  const fullSignals = groupCounts.map((count) => count === 1);
  if (fullSignals.every(Boolean)) {
    return annual ? "annual-tx-full-v1" : `daily-${actionKey.toLowerCase()}-full-v1`;
  }
  if (fullSignals.every((signal) => !signal)) {
    return annual ? "annual-tx-status-only-v1" : null;
  }
  return annual ? "annual-tx-partial-v1" : `daily-${actionKey.toLowerCase()}-partial-v1`;
}

function validateScalarUniqueness(root: XmlNode, raw: Buffer) {
  const occurrences = new Map<string, number>();
  const walk = (node: XmlNode, parentPath: string) => {
    const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
    const occurrence = (occurrences.get(path) ?? 0) + 1;
    occurrences.set(path, occurrence);
    if (occurrence > 1 && scalarClaimPaths.has(path)) {
      throw new ParseFailure(`ambiguous ${path}`, raw);
    }
    for (const child of node.children) {
      walk(child, path);
    }
  };
  walk(root, "");
}

function isClass025Observation(root: XmlNode) {
  const [header] = direct(root, "case-file-header");
  const [markIdentification] = header ? direct(header, "mark-identification") : [];
  if (
    !markIdentification ||
    markIdentification.children.length > 0 ||
    decodeXmlText(markIdentification.rawValue).trim() === ""
  ) {
    return false;
  }
  return direct(root, "classifications").some((classifications) =>
    direct(classifications, "classification").some((classification) =>
      direct(classification, "primary-code").some(
        (code) => code.children.length === 0 && code.rawValue.trim() === "025"
      )
    )
  );
}

function claimPresence(node: XmlNode): SourceValue["presence"] {
  if (node.children.length > 0) {
    return "group";
  }
  return node.rawValue === "" ? "empty" : "value";
}

function claimOperation(
  node: XmlNode,
  path: string,
  presence: SourceValue["presence"],
  profile: string
): ClaimOperation {
  const collection =
    path === "case-file/case-file-statements" || path === "case-file/classifications";
  let operation: ClaimOperation = collection && !profile.includes("-partial-") ? "replace" : null;
  if (
    path === "case-file/case-file-owners" &&
    presence === "group" &&
    node.children.some((child) => child.name === "case-file-owner")
  ) {
    operation = "replace";
  }
  if (path === "case-file/case-file-event-statements") {
    operation = "assert";
  }
  if (presence === "value" && scalarClaimPaths.has(path)) {
    operation = "set";
  }
  return operation;
}

function recordsClaimPresence(path: string, operation: ClaimOperation) {
  return (
    operation !== null ||
    path === "case-file/case-file-statements" ||
    path === "case-file/classifications" ||
    scalarClaimPaths.has(path) ||
    path === "case-file/correspondent" ||
    path === "case-file/case-file-owners" ||
    path.endsWith("/name-change-explanation")
  );
}

function claimsFrom(root: XmlNode, profile: string) {
  const occurrences = new Map<string, number>();
  const claims: SourceClaim[] = [];
  const walk = (node: XmlNode, parentPath: string) => {
    const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
    const occurrence = (occurrences.get(path) ?? 0) + 1;
    occurrences.set(path, occurrence);
    const presence = claimPresence(node);
    const operation = claimOperation(node, path, presence, profile);
    if (recordsClaimPresence(path, operation)) {
      claims.push({
        occurrence,
        operation,
        path,
        presence,
        rawValue: node.children.length > 0 ? null : node.rawValue,
      });
    }
    for (const child of node.children) {
      walk(child, path);
    }
  };
  walk(root, "");
  return claims;
}

function parseDate(raw: string | null) {
  if (!(raw && compactDatePattern.test(raw))) {
    return null;
  }
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

interface Framing {
  actionKey: string;
  actionKeyCount: number;
  actionOccurrence: number;
  actionRecordIndex: number;
  actionRecords: number;
  applicationClosed: boolean;
  applicationSeen: boolean;
  creationSeen: boolean;
  dataAvailableCode: string | null;
  fileSegmentSeen: boolean;
  fileSegmentsClosed: boolean;
  fileSegmentsSeen: boolean;
  prologState: "after-doctype" | "after-xml" | "body" | "doctype" | "start";
  recordsSeen: number;
  rootClosed: boolean;
  rootSeen: boolean;
  schemaVersion: string;
  schemaVersionDate: string;
  stack: Array<{ name: OuterTag; text: string }>;
  versionClosed: boolean;
  versionSeen: boolean;
}

type OuterTag =
  | "action-key"
  | "action-keys"
  | "application-information"
  | "creation-datetime"
  | "data-available-code"
  | "file-segment"
  | "file-segments"
  | "trademark-applications-daily"
  | "version"
  | "version-date"
  | "version-no";

const outerTags = new Set<OuterTag>([
  "action-key",
  "action-keys",
  "application-information",
  "creation-datetime",
  "data-available-code",
  "file-segment",
  "file-segments",
  "trademark-applications-daily",
  "version",
  "version-date",
  "version-no",
]);

const containerOuterTags: OuterTag[] = [
  "trademark-applications-daily",
  "version",
  "application-information",
  "file-segments",
  "action-keys",
];

function consumeOuterText(token: string, bytes: Buffer, framing: Framing) {
  validateXmlCharacters(token, bytes);
  if (framing.prologState === "doctype") {
    const close = token.indexOf("]>");
    if (close < 0) {
      return;
    }
    if (token.slice(close + 2).trim() !== "") {
      throw new ParseFailure("text after document type", bytes);
    }
    framing.prologState = "after-doctype";
    return;
  }
  validateXmlEntities(token, bytes);
  const current = framing.stack.at(-1);
  if (current && !containerOuterTags.includes(current.name)) {
    current.text += token;
  } else if (token.trim() !== "") {
    throw new ParseFailure("unexpected outer text", bytes);
  }
}

function consumeOuterDeclaration(token: string, bytes: Buffer, framing: Framing) {
  if (token.startsWith("<?")) {
    if (
      token === '<?xml version="1.0" encoding="utf-8"?>' &&
      framing.prologState === "start" &&
      framing.stack.length === 0
    ) {
      framing.prologState = "after-xml";
      return;
    }
    throw new ParseFailure("misplaced XML declaration", bytes);
  }
  if (token.startsWith("<!DOCTYPE")) {
    const validDoctype =
      token.startsWith("<!DOCTYPE trademark-applications-daily [") &&
      ["start", "after-xml"].includes(framing.prologState) &&
      framing.stack.length === 0;
    if (!validDoctype) {
      throw new ParseFailure("misplaced document type", bytes);
    }
    framing.prologState = token.includes("]>") ? "after-doctype" : "doctype";
    return;
  }
  if (framing.prologState !== "doctype") {
    throw new ParseFailure("misplaced declaration", bytes);
  }
}

function closeScalarOuterElement(
  name: OuterTag,
  value: string,
  bytes: Buffer,
  framing: Framing,
  actionOccurrences: Map<string, number>
) {
  if (name === "version-no") {
    framing.schemaVersion = value;
  } else if (name === "version-date") {
    framing.schemaVersionDate = value;
  } else if (name === "creation-datetime") {
    if (value === "") {
      throw new ParseFailure("missing creation datetime", bytes);
    }
    framing.creationSeen = true;
  } else if (name === "file-segment") {
    if (value === "") {
      throw new ParseFailure("empty file segment", bytes);
    }
    framing.fileSegmentSeen = true;
  } else if (name === "action-key") {
    if (value === "") {
      throw new ParseFailure("empty action key", bytes);
    }
    framing.actionKey = value;
    framing.actionKeyCount += 1;
    framing.actionOccurrence = (actionOccurrences.get(value) ?? 0) + 1;
    actionOccurrences.set(value, framing.actionOccurrence);
    framing.actionRecordIndex = 0;
  } else if (name === "data-available-code") {
    framing.dataAvailableCode = value;
  }
}

function closeContainerOuterElement(name: OuterTag, bytes: Buffer, framing: Framing) {
  if (name === "version") {
    if (framing.schemaVersion === "" || framing.schemaVersionDate === "") {
      throw new ParseFailure("incomplete version", bytes);
    }
    framing.versionClosed = true;
  } else if (name === "action-keys") {
    if (framing.actionKeyCount !== 1 || framing.actionRecords === 0) {
      throw new ParseFailure("invalid action group", bytes);
    }
  } else if (name === "file-segments") {
    if (!framing.fileSegmentSeen || framing.recordsSeen === 0) {
      throw new ParseFailure("empty file segments", bytes);
    }
    framing.fileSegmentsClosed = true;
  } else if (name === "application-information") {
    const noData = framing.dataAvailableCode === "N" && !framing.fileSegmentsSeen;
    const records = framing.fileSegmentsClosed && framing.dataAvailableCode === null;
    if (!(noData || records)) {
      throw new ParseFailure("invalid application envelope", bytes);
    }
    framing.applicationClosed = true;
  }
}

function closeRootOuterElement(name: OuterTag, bytes: Buffer, framing: Framing) {
  if (name === "trademark-applications-daily") {
    if (!framing.applicationClosed) {
      throw new ParseFailure("incomplete application envelope", bytes);
    }
    framing.rootClosed = true;
  }
}

function closeOuterElement(
  name: OuterTag,
  bytes: Buffer,
  framing: Framing,
  actionOccurrences: Map<string, number>
) {
  const current = framing.stack.pop();
  if (!current || current.name !== name) {
    throw new ParseFailure("mismatched outer tags", bytes);
  }
  const value = current.text.trim();
  closeScalarOuterElement(name, value, bytes, framing, actionOccurrences);
  closeContainerOuterElement(name, bytes, framing);
  closeRootOuterElement(name, bytes, framing);
}

function canOpenOuterElement(name: OuterTag, parent: OuterTag | undefined, framing: Framing) {
  switch (name) {
    case "trademark-applications-daily":
      return (
        parent === undefined &&
        !framing.rootSeen &&
        ["start", "after-xml", "after-doctype"].includes(framing.prologState)
      );
    case "version":
      return (
        parent === "trademark-applications-daily" && !framing.versionSeen && !framing.creationSeen
      );
    case "version-no":
      return parent === "version" && framing.schemaVersion === "";
    case "version-date":
      return (
        parent === "version" && framing.schemaVersion !== "" && framing.schemaVersionDate === ""
      );
    case "creation-datetime":
      return (
        parent === "trademark-applications-daily" && framing.versionClosed && !framing.creationSeen
      );
    case "application-information":
      return (
        parent === "trademark-applications-daily" &&
        framing.creationSeen &&
        !framing.applicationSeen
      );
    case "file-segments":
      return (
        parent === "application-information" &&
        !framing.fileSegmentsSeen &&
        framing.dataAvailableCode === null
      );
    case "file-segment":
      return parent === "file-segments" && framing.recordsSeen === 0;
    case "action-keys":
      return parent === "file-segments" && framing.fileSegmentSeen;
    case "action-key":
      return (
        parent === "action-keys" && framing.actionKeyCount === 0 && framing.actionRecords === 0
      );
    case "data-available-code":
      return (
        parent === "application-information" &&
        !framing.fileSegmentsSeen &&
        framing.dataAvailableCode === null
      );
    default:
      return false;
  }
}

function openOuterElement(name: OuterTag, bytes: Buffer, framing: Framing) {
  if (!canOpenOuterElement(name, framing.stack.at(-1)?.name, framing)) {
    throw new ParseFailure("misnested outer element", bytes);
  }
  if (name === "trademark-applications-daily") {
    framing.rootSeen = true;
    framing.prologState = "body";
  } else if (name === "version") {
    framing.versionSeen = true;
  } else if (name === "application-information") {
    framing.applicationSeen = true;
  } else if (name === "file-segments") {
    framing.fileSegmentsSeen = true;
  } else if (name === "action-keys") {
    framing.actionKey = "";
    framing.actionKeyCount = 0;
    framing.actionRecords = 0;
  }
  framing.stack.push({ name, text: "" });
}

function consumeFraming(bytes: Buffer, framing: Framing, actionOccurrences: Map<string, number>) {
  const text = decodeUtf8(bytes);
  const tokens = text.match(outerTokensPattern) ?? [];
  if (tokens.join("") !== text) {
    throw new ParseFailure("malformed outer XML", bytes);
  }
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      consumeOuterText(token, bytes, framing);
      continue;
    }
    if (token.startsWith("<!") || token.startsWith("<?")) {
      consumeOuterDeclaration(token, bytes, framing);
      continue;
    }
    const match = token.match(outerElementPattern);
    const name = match?.[2] as OuterTag | undefined;
    if (!(name && outerTags.has(name))) {
      throw new ParseFailure("unsupported outer element", bytes);
    }
    if (match?.[1] === "/") {
      closeOuterElement(name, bytes, framing, actionOccurrences);
    } else {
      openOuterElement(name, bytes, framing);
    }
  }
}

interface SourceRecordRow {
  action_key: string;
  action_occurrence: number;
  action_record_index: number;
  digest: string;
  id: string;
  parse_run_id: string;
  physical_record_index: number;
  profile: string;
  schema_version: string;
  schema_version_date: string;
  serial_number: string;
  source_transaction_date: string | null;
  source_transaction_date_raw: string | null;
  values: SourceValue[];
}

interface SourceClaimRow {
  claim_order: number;
  id: string;
  occurrence: number;
  operation: ClaimOperation;
  path: string;
  presence: SourceValue["presence"];
  raw_value: string | null;
  source_record_id: string;
}

function framingState(): Framing {
  return {
    actionKey: "",
    actionKeyCount: 0,
    actionOccurrence: 0,
    actionRecordIndex: 0,
    actionRecords: 0,
    applicationClosed: false,
    applicationSeen: false,
    creationSeen: false,
    dataAvailableCode: null,
    fileSegmentSeen: false,
    fileSegmentsClosed: false,
    fileSegmentsSeen: false,
    prologState: "start",
    recordsSeen: 0,
    rootClosed: false,
    rootSeen: false,
    schemaVersion: "",
    schemaVersionDate: "",
    stack: [],
    versionClosed: false,
    versionSeen: false,
  };
}

async function claimParseRun(
  transaction: postgres.TransactionSql,
  artifactVersionId: string,
  parseRunId: string
) {
  const [inserted] = await transaction<Array<{ id: string }>>`
    insert into parse_run (id, artifact_version_id, parser_version)
    values (${parseRunId}, ${artifactVersionId}, ${sourceObservationParserVersion})
    on conflict (artifact_version_id, parser_version) do nothing
    returning id
  `;
  if (!inserted) {
    const [concurrentRun] = await transaction<ParseRunRow[]>`
      select id as "parseRunId", state, digest, record_count as "recordCount",
        reject_count as "rejectCount"
      from parse_run
      where artifact_version_id = ${artifactVersionId} and parser_version = ${sourceObservationParserVersion}
    `;
    if (!concurrentRun) {
      throw new Error("Concurrent parse run disappeared");
    }
    const concurrentResult = terminalParseResult(concurrentRun);
    if (concurrentResult) {
      return concurrentResult;
    }
    throw new Error("Parse run already in progress");
  }
  const [claimed] = await transaction<Array<{ id: string }>>`
    update artifact_version set state = 'parsing'
    where id = ${artifactVersionId} and state in ('verified', 'staged', 'published')
    returning id
  `;
  if (!claimed) {
    throw new Error("Artifact version must be verified, staged, or published to parse");
  }
  return null;
}

async function flushObservationRows(
  transaction: postgres.TransactionSql,
  recordRows: SourceRecordRow[],
  claimRows: SourceClaimRow[]
) {
  if (recordRows.length === 0) {
    return;
  }
  await transaction`
    insert into source_record ${transaction(
      recordRows.map((row) => ({ ...row, values: transaction.json(row.values) })),
      "id",
      "parse_run_id",
      "physical_record_index",
      "action_key",
      "action_occurrence",
      "action_record_index",
      "serial_number",
      "source_transaction_date",
      "source_transaction_date_raw",
      "schema_version",
      "schema_version_date",
      "profile",
      "digest",
      "values"
    )}
  `;
  if (claimRows.length > 0) {
    await transaction`
      insert into source_claim ${transaction(
        claimRows,
        "id",
        "source_record_id",
        "claim_order",
        "path",
        "occurrence",
        "presence",
        "operation",
        "raw_value"
      )}
    `;
  }
  recordRows.length = 0;
  claimRows.length = 0;
}

function parseRecordAtIndex(raw: Buffer, physicalRecordIndex: number) {
  try {
    return parseRecord(raw);
  } catch (cause) {
    if (cause instanceof ParseFailure) {
      const failure = new ParseFailure(cause.reason, raw, physicalRecordIndex, { cause });
      throw failure;
    }
    throw cause;
  }
}

function serialNumberFrom(root: XmlNode, raw: Buffer, physicalRecordIndex: number) {
  try {
    return scalar(root, "serial-number", raw)?.trim() ?? "";
  } catch (cause) {
    if (cause instanceof ParseFailure) {
      const failure = new ParseFailure(cause.reason, raw, physicalRecordIndex, { cause });
      throw failure;
    }
    throw cause;
  }
}

function selectedObservationRows(
  raw: Buffer,
  physicalRecordIndex: number,
  productId: string,
  parseRunId: string,
  framing: Framing
): { claims: SourceClaimRow[]; record: SourceRecordRow } | null {
  if (
    !framing.rootSeen ||
    framing.schemaVersion !== "2.0" ||
    framing.schemaVersionDate !== "20041108"
  ) {
    throw new ParseFailure("unsupported root or schema version", raw, physicalRecordIndex);
  }
  const root = parseRecordAtIndex(raw, physicalRecordIndex);
  const serialNumber = serialNumberFrom(root, raw, physicalRecordIndex);
  if (!digitsPattern.test(serialNumber)) {
    throw new ParseFailure("missing mandatory case identity", raw, physicalRecordIndex);
  }
  const profile = profileRecord(root, productId, framing.actionKey);
  if (!profile) {
    throw new ParseFailure("unsupported source shape", raw, physicalRecordIndex);
  }
  const sourceTransactionDateRaw = scalar(root, "transaction-date", raw);
  const sourceTransactionDate = parseDate(sourceTransactionDateRaw);
  validateScalarUniqueness(root, raw);
  if (!isClass025Observation(root)) {
    return null;
  }
  const sourceRecordId = randomUUID();
  const claims = claimsFrom(root, profile).map((claim, claimOrder) => ({
    claim_order: claimOrder + 1,
    id: randomUUID(),
    occurrence: claim.occurrence,
    operation: claim.operation,
    path: claim.path,
    presence: claim.presence,
    raw_value: claim.rawValue,
    source_record_id: sourceRecordId,
  }));
  return {
    claims,
    record: {
      action_key: framing.actionKey,
      action_occurrence: framing.actionOccurrence,
      action_record_index: framing.actionRecordIndex,
      digest: createHash("sha256").update(raw).digest("hex"),
      id: sourceRecordId,
      parse_run_id: parseRunId,
      physical_record_index: physicalRecordIndex,
      profile,
      schema_version: framing.schemaVersion,
      schema_version_date: framing.schemaVersionDate,
      serial_number: serialNumber,
      source_transaction_date: sourceTransactionDate,
      source_transaction_date_raw: sourceTransactionDateRaw,
      values: [toSourceValue(root)],
    },
  };
}

function openPendingRecord(
  initial: Buffer,
  framing: Framing,
  actionOccurrences: Map<string, number>
) {
  let pending = initial;
  for (;;) {
    const start = pending.indexOf(recordStart);
    if (start >= 0) {
      const previousNewline = pending.lastIndexOf(10, start - 1);
      const lineStart = previousNewline < 0 ? 0 : previousNewline + 1;
      consumeFraming(pending.subarray(0, lineStart), framing, actionOccurrences);
      return { opened: true, pending: pending.subarray(lineStart) };
    }
    const lastBoundary = pending.lastIndexOf(62);
    const outerTokenBytes = pending.byteLength - (lastBoundary + 1);
    if (outerTokenBytes > maxOuterTokenBytes) {
      throw new ParseFailure(
        `outer XML token exceeds ${maxOuterTokenBytes} byte limit`,
        pending.subarray(lastBoundary + 1, lastBoundary + 1 + maxOuterTokenBytes + inputSliceBytes)
      );
    }
    if (pending.byteLength <= 2048) {
      return { opened: false, pending };
    }
    const boundary = pending.lastIndexOf(62, pending.byteLength - 1024) + 1;
    if (boundary <= 0) {
      return { opened: false, pending };
    }
    consumeFraming(pending.subarray(0, boundary), framing, actionOccurrences);
    pending = pending.subarray(boundary);
  }
}

function completePendingRecord(pending: Buffer, physicalRecordIndex: number) {
  const start = pending.indexOf(recordStart);
  const end = pending.indexOf(recordEnd, start + recordStart.byteLength);
  const nested = pending.indexOf(recordStart, start + recordStart.byteLength);
  if (nested >= 0 && (end < 0 || nested < end)) {
    throw new ParseFailure("ambiguous record boundaries", pending, physicalRecordIndex);
  }
  if (end < 0) {
    if (pending.byteLength > maxRecordBytes) {
      throw new ParseFailure(
        `record exceeds ${maxRecordBytes} byte limit`,
        pending,
        physicalRecordIndex
      );
    }
    return null;
  }
  const closeEnd = end + recordEnd.byteLength;
  const followingNewline = pending.indexOf(10, closeEnd);
  if (followingNewline < 0) {
    if (pending.byteLength > maxRecordBytes) {
      throw new ParseFailure(
        `record exceeds ${maxRecordBytes} byte limit`,
        pending,
        physicalRecordIndex
      );
    }
    return null;
  }
  const recordBytes = pending.subarray(0, followingNewline + 1);
  if (recordBytes.byteLength > maxRecordBytes) {
    throw new ParseFailure(
      `record exceeds ${maxRecordBytes} byte limit`,
      recordBytes,
      physicalRecordIndex
    );
  }
  return { pending: pending.subarray(followingNewline + 1), recordBytes };
}

async function consumePendingRecords(
  initialPending: Buffer,
  initialRecordOpen: boolean,
  framing: Framing,
  actionOccurrences: Map<string, number>,
  nextPhysicalRecordIndex: () => number,
  persistRecord: (raw: Buffer) => Promise<void>
) {
  let pending = initialPending;
  let recordOpen = initialRecordOpen;
  // biome-ignore lint/suspicious/noUnnecessaryConditions: Scanning stops only when the current byte buffer is incomplete.
  while (true) {
    if (!recordOpen) {
      const opened = openPendingRecord(pending, framing, actionOccurrences);
      ({ opened: recordOpen, pending } = opened);
      if (!recordOpen) {
        return { pending, recordOpen };
      }
    }
    const completed = completePendingRecord(pending, nextPhysicalRecordIndex());
    if (!completed) {
      return { pending, recordOpen };
    }
    const { pending: remaining, recordBytes } = completed;
    pending = remaining;
    recordOpen = false;
    // biome-ignore lint/performance/noAwaitInLoops: Physical records are validated and persisted in source order.
    await persistRecord(recordBytes);
  }
}

async function stageArtifactTransaction(
  transaction: postgres.TransactionSql,
  input: StageInput,
  productId: string,
  parseRunId: string,
  digest: ReturnType<typeof createHash>
): Promise<ParseResult> {
  const concurrentResult = await claimParseRun(transaction, input.artifactVersionId, parseRunId);
  if (concurrentResult) {
    return concurrentResult;
  }
  const recordRows: SourceRecordRow[] = [];
  const claimRows: SourceClaimRow[] = [];
  const framing = framingState();
  const actionOccurrences = new Map<string, number>();
  let recordCount = 0;
  const persistRecord = async (raw: Buffer) => {
    recordCount += 1;
    if (framing.stack.at(-1)?.name !== "action-keys" || framing.actionKeyCount !== 1) {
      throw new ParseFailure("case-file outside action group", raw, recordCount);
    }
    framing.actionRecordIndex += 1;
    framing.actionRecords += 1;
    framing.recordsSeen += 1;
    const selected = selectedObservationRows(raw, recordCount, productId, parseRunId, framing);
    if (!selected) {
      return;
    }
    recordRows.push(selected.record);
    claimRows.push(...selected.claims);
    if (recordRows.length === recordBatchSize) {
      await flushObservationRows(transaction, recordRows, claimRows);
    }
  };

  let pending = Buffer.allocUnsafe(inputSliceBytes);
  let pendingBytes = 0;
  let recordOpen = false;
  for await (const chunk of input.xml) {
    digest.update(chunk);
    for (let offset = 0; offset < chunk.byteLength; offset += inputSliceBytes) {
      const slice = Buffer.from(chunk.subarray(offset, offset + inputSliceBytes));
      const requiredBytes = pendingBytes + slice.byteLength;
      if (requiredBytes > pending.byteLength) {
        const capacity = Math.min(
          maxRecordBytes + inputSliceBytes,
          Math.max(requiredBytes, pending.byteLength * 2)
        );
        const expanded = Buffer.allocUnsafe(capacity);
        pending.copy(expanded, 0, 0, pendingBytes);
        pending = expanded;
      }
      slice.copy(pending, pendingBytes);
      pendingBytes = requiredBytes;
      // biome-ignore lint/performance/noAwaitInLoops: One artifact's physical records are parsed and persisted sequentially.
      const consumed = await consumePendingRecords(
        pending.subarray(0, pendingBytes),
        recordOpen,
        framing,
        actionOccurrences,
        () => recordCount + 1,
        persistRecord
      );
      consumed.pending.copy(pending, 0);
      pendingBytes = consumed.pending.byteLength;
      ({ recordOpen } = consumed);
    }
  }
  const remaining = pending.subarray(0, pendingBytes);
  if (recordOpen || remaining.includes(recordStart)) {
    const actionClose = remaining.indexOf(Buffer.from("</action-keys>"));
    const rejected = actionClose < 0 ? remaining : remaining.subarray(0, actionClose);
    throw new ParseFailure("malformed or truncated XML", rejected, recordCount + 1);
  }
  consumeFraming(remaining, framing, actionOccurrences);
  if (
    !(framing.rootSeen && framing.rootClosed) ||
    framing.stack.length !== 0 ||
    framing.schemaVersion !== "2.0" ||
    framing.schemaVersionDate !== "20041108"
  ) {
    throw new ParseFailure("unsupported root or schema version", remaining);
  }
  await flushObservationRows(transaction, recordRows, claimRows);
  const runDigest = digest.digest("hex");
  await lockCorpusPublication(transaction);
  await transaction`
    update parse_run set state = 'staged', digest = ${runDigest}, record_count = ${recordCount},
      finished_at = now() where id = ${parseRunId}
  `;
  await transaction`update artifact_version set state = 'staged' where id = ${input.artifactVersionId}`;
  return { digest: runDigest, parseRunId, recordCount, rejectCount: 0, status: "staged" };
}

function quarantineParseFailure(
  database: postgres.Sql,
  input: StageInput,
  parseRunId: string,
  runDigest: string,
  failure: ParseFailure
) {
  return database.begin(async (transaction) => {
    const [inserted] = await transaction<Array<{ id: string }>>`
      insert into parse_run (
        id, artifact_version_id, state, parser_version, digest, record_count, reject_count, finished_at
      ) values (
        ${parseRunId}, ${input.artifactVersionId}, 'quarantined', ${sourceObservationParserVersion}, ${runDigest}, 0, 1, now()
      )
      on conflict (artifact_version_id, parser_version) do nothing
      returning id
    `;
    if (!inserted) {
      const [winner] = await transaction<ParseRunRow[]>`
        select id as "parseRunId", state, digest, record_count as "recordCount",
          reject_count as "rejectCount"
        from parse_run
        where artifact_version_id = ${input.artifactVersionId} and parser_version = ${sourceObservationParserVersion}
      `;
      if (!winner) {
        throw new Error("Concurrent parse run disappeared");
      }
      const winnerResult = terminalParseResult(winner);
      if (winnerResult) {
        return winnerResult;
      }
      throw new Error("Parse run already in progress");
    }
    const { rawXml } = failure;
    await transaction`
      insert into parse_reject (id, parse_run_id, physical_record_index, reason, raw_xml, bytes, digest)
      values (
        ${randomUUID()}, ${parseRunId}, ${failure.physicalRecordIndex}, ${failure.reason}, ${rawXml},
        ${rawXml.byteLength}, ${createHash("sha256").update(rawXml).digest("hex")}
      )
    `;
    await transaction`
      update artifact_version set
        state = 'quarantined',
        quarantined_at = now(),
        quarantine_reason = ${failure.reason}
      where id = ${input.artifactVersionId}
    `;
    return {
      digest: runDigest,
      parseRunId,
      recordCount: 0,
      rejectCount: 1,
      status: "quarantined" as const,
    };
  });
}

export function createSourceObservationModule(database: postgres.Sql) {
  return {
    async *readRecords(parseRunId: string): AsyncIterable<SourceObservation> {
      const query = database<SourceObservation[]>`
        select action_key as "actionKey", action_occurrence as "actionOccurrence",
          action_record_index as "actionRecordIndex", r.digest, physical_record_index as "physicalRecordIndex",
          a.product_id as product, v.sha256 as "artifactVersionSha256",
          profile, schema_version as "schemaVersion", schema_version_date as "schemaVersionDate",
          serial_number as "serialNumber", source_transaction_date::text as "sourceTransactionDate",
          source_transaction_date_raw as "sourceTransactionDateRaw", values,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'occurrence', c.occurrence, 'operation', c.operation, 'path', c.path,
                'presence', c.presence, 'rawValue', c.raw_value
              ) order by c.claim_order
            ) filter (where c.id is not null), '[]'::jsonb
          ) as claims
        from source_record r
        join parse_run p on p.id = r.parse_run_id
        join artifact_version v on v.id = p.artifact_version_id
        join artifact a on a.id = v.artifact_id
        left join source_claim c on c.source_record_id = r.id
        where r.parse_run_id = ${parseRunId}
        group by r.id, a.product_id, v.sha256
        order by physical_record_index
      `;
      for await (const batch of query.cursor(100)) {
        for (const record of batch) {
          yield record;
        }
      }
    },

    async *readRejects(parseRunId: string): AsyncIterable<SourceReject> {
      const query = database<SourceReject[]>`
        select bytes, digest, physical_record_index as "physicalRecordIndex", raw_xml as "rawXml", reason
        from parse_reject where parse_run_id = ${parseRunId} order by created_at, id
      `;
      for await (const batch of query.cursor(100)) {
        for (const reject of batch) {
          yield reject;
        }
      }
    },
    async stageArtifact(input: StageInput): Promise<ParseResult> {
      const [artifactVersion] = await database<Array<ParseRunRow & { productId: string }>>`
        select a.product_id as "productId", r.id as "parseRunId", r.state, r.digest,
          r.record_count as "recordCount", r.reject_count as "rejectCount"
        from artifact_version v
        join artifact a on a.id = v.artifact_id
        left join parse_run r on r.artifact_version_id = v.id and r.parser_version = ${sourceObservationParserVersion}
        where v.id = ${input.artifactVersionId}
      `;
      if (!artifactVersion) {
        throw new Error("Artifact version not found");
      }
      const existingResult = terminalParseResult(artifactVersion);
      if (existingResult) {
        return existingResult;
      }
      if (artifactVersion.state === "parsing") {
        throw new Error("Parse run already in progress");
      }
      const parseRunId = randomUUID();
      const digest = createHash("sha256");
      try {
        return await database.begin((transaction) =>
          stageArtifactTransaction(
            transaction,
            input,
            artifactVersion.productId,
            parseRunId,
            digest
          )
        );
      } catch (error) {
        if (!(error instanceof ParseFailure)) {
          throw error;
        }
        return quarantineParseFailure(
          database,
          input,
          parseRunId,
          digest.copy().digest("hex"),
          error
        );
      }
    },
  };
}
