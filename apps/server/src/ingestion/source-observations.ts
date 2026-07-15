import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

import type { SourceValue } from "../db/schema.ts";

const parserVersion = "uspto-application-xml-v1";
const recordStart = Buffer.from("<case-file>");
const recordEnd = Buffer.from("</case-file>");
const recordBatchSize = 100;
const inputSliceBytes = 64 * 1024;
const maxRecordBytes = 512 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

type ClaimOperation = "assert" | "clear" | "replace" | "set" | null;

export type SourceClaim = {
  occurrence: number;
  operation: ClaimOperation;
  path: string;
  presence: SourceValue["presence"];
  rawValue: string | null;
};

export type SourceObservation = {
  actionKey: string;
  actionOccurrence: number;
  actionRecordIndex: number;
  claims: SourceClaim[];
  digest: string;
  physicalRecordIndex: number;
  profile: string;
  schemaVersion: string;
  schemaVersionDate: string;
  serialNumber: string;
  sourceTransactionDate: string | null;
  sourceTransactionDateRaw: string | null;
  values: SourceValue[];
};

export type ParseResult = {
  digest: string;
  parseRunId: string;
  recordCount: number;
  rejectCount: number;
  status: "quarantined" | "staged";
};

export type SourceReject = {
  bytes: number;
  digest: string;
  physicalRecordIndex: number | null;
  rawXml: Buffer;
  reason: string;
};

type ParseRunRow = {
  digest: string | null;
  parseRunId: string | null;
  recordCount: number | null;
  rejectCount: number | null;
  state: "parsing" | "quarantined" | "staged" | null;
};

function terminalParseResult(run: ParseRunRow): ParseResult | null {
  if (run.state !== "staged" && run.state !== "quarantined") return null;
  if (!run.parseRunId || !run.digest || run.recordCount === null || run.rejectCount === null) {
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

type StageInput = {
  artifactVersionId: string;
  xml: ReadableStream<Uint8Array>;
};

class ParseFailure extends Error {
  constructor(
    readonly reason: string,
    readonly rawXml: Buffer,
    readonly physicalRecordIndex: number | null = null,
  ) {
    super(reason);
  }
}

type XmlNode = { name: string; children: XmlNode[]; rawValue: string };
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
  } catch {
    throw new ParseFailure("invalid UTF-8", raw);
  }
}

function validXmlCodePoint(codePoint: number) {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function validateXmlCharacters(text: string, raw: Buffer) {
  for (const character of text) {
    if (!validXmlCodePoint(character.codePointAt(0)!)) throw new ParseFailure("invalid XML character", raw);
  }
}

function validateXmlEntities(text: string, raw: Buffer) {
  for (let offset = text.indexOf("&"); offset >= 0; offset = text.indexOf("&", offset + 1)) {
    const reference = text.slice(offset).match(/^&(amp|apos|gt|lt|quot|#\d+|#x[\da-fA-F]+);/);
    if (!reference) throw new ParseFailure("invalid XML entity", raw);
    const value = reference[1]!;
    if (value.startsWith("#")) {
      const codePoint = value.startsWith("#x") ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10);
      if (!validXmlCodePoint(codePoint)) throw new ParseFailure("invalid XML entity", raw);
    }
    offset += reference[0].length - 1;
  }
}

function parseRecord(raw: Buffer) {
  const xml = decodeUtf8(raw);
  const tokenPattern = /<\/?[a-z0-9-]+>|<[a-z0-9-]+\s*\/>|[^<]+/g;
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  let offset = 0;
  for (const match of xml.matchAll(tokenPattern)) {
    if (match.index !== offset) throw new ParseFailure("malformed XML", raw);
    const token = match[0];
    offset += token.length;
    if (token.startsWith("</")) {
      const name = token.slice(2, -1);
      const node = stack.pop();
      if (!node || node.name !== name) throw new ParseFailure("malformed XML", raw);
      continue;
    }
    if (token.startsWith("<")) {
      const selfClosing = /\s*\/>$/.test(token);
      const name = token.match(/^<([a-z0-9-]+)/)?.[1];
      if (!name) throw new ParseFailure("unsupported XML construct", raw);
      const node: XmlNode = { name, children: [], rawValue: "" };
      const parent = stack.at(-1);
      if (parent) parent.children.push(node);
      else roots.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }
    validateXmlCharacters(token, raw);
    const node = stack.at(-1);
    if (!node) {
      if (token.trim() !== "") throw new ParseFailure("text outside case-file", raw);
    } else if (node.children.length > 0) {
      if (token.trim() !== "") throw new ParseFailure("mixed XML content is unsupported", raw);
    } else {
      validateXmlEntities(token, raw);
      node.rawValue += token;
    }
  }
  if (offset !== xml.length || stack.length !== 0 || roots.length !== 1 || roots[0]?.name !== "case-file") {
    throw new ParseFailure("malformed XML", raw);
  }
  return roots[0];
}

function toSourceValue(node: XmlNode): SourceValue {
  if (node.children.length > 0) {
    return { name: node.name, presence: "group", children: node.children.map(toSourceValue) };
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
  if (matches.length > 1) throw new ParseFailure(`ambiguous ${name}`, raw);
  const match = matches[0];
  if (!match || match.children.length > 0) return null;
  return match.rawValue;
}

function profileRecord(root: XmlNode, productId: string, actionKey: string) {
  const annual = productId === "TRTYRAP" && actionKey === "TX";
  const daily = productId === "TRTDXFAP" && (actionKey === "IB" || actionKey === "NA" || actionKey === "TX");
  if (!annual && !daily) return null;
  const header = direct(root, "case-file-header");
  if (header.length !== 1) return null;
  const groupCounts = [
    direct(header[0]!, "mark-identification").length,
    direct(root, "case-file-statements").length,
    direct(root, "classifications").length,
    direct(root, "case-file-owners").length,
  ];
  if (groupCounts.some((count) => count > 1)) return null;
  const fullSignals = groupCounts.map((count) => count === 1);
  if (fullSignals.every(Boolean)) return annual ? "annual-tx-full-v1" : `daily-${actionKey.toLowerCase()}-full-v1`;
  if (fullSignals.every((signal) => !signal)) return annual ? "annual-tx-status-only-v1" : null;
  return annual ? "annual-tx-partial-v1" : `daily-${actionKey.toLowerCase()}-partial-v1`;
}

function validateScalarUniqueness(root: XmlNode, raw: Buffer) {
  const occurrences = new Map<string, number>();
  const walk = (node: XmlNode, parentPath: string) => {
    const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
    const occurrence = (occurrences.get(path) ?? 0) + 1;
    occurrences.set(path, occurrence);
    if (occurrence > 1 && scalarClaimPaths.has(path)) throw new ParseFailure(`ambiguous ${path}`, raw);
    for (const child of node.children) walk(child, path);
  };
  walk(root, "");
}

function claimsFrom(root: XmlNode, profile: string) {
  const occurrences = new Map<string, number>();
  const claims: SourceClaim[] = [];
  const walk = (node: XmlNode, parentPath: string) => {
    const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
    const occurrence = (occurrences.get(path) ?? 0) + 1;
    occurrences.set(path, occurrence);
    const presence: SourceValue["presence"] = node.children.length > 0 ? "group" : node.rawValue === "" ? "empty" : "value";
    let operation: ClaimOperation = null;
    const collection = path === "case-file/case-file-statements" || path === "case-file/classifications";
    if (collection && !profile.includes("-partial-")) operation = "replace";
    if (path === "case-file/case-file-event-statements") operation = "assert";
    if (presence === "value" && scalarClaimPaths.has(path)) operation = "set";
    const recordsPresence =
      operation !== null ||
      collection ||
      path === "case-file/correspondent" ||
      path === "case-file/case-file-owners" ||
      path.endsWith("/name-change-explanation");
    if (recordsPresence) {
      claims.push({ occurrence, operation, path, presence, rawValue: node.children.length > 0 ? null : node.rawValue });
    }
    for (const child of node.children) walk(child, path);
  };
  walk(root, "");
  return claims;
}

function parseDate(raw: string | null) {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

type Framing = {
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
  recordsSeen: number;
  prologState: "after-doctype" | "after-xml" | "body" | "doctype" | "start";
  rootSeen: boolean;
  rootClosed: boolean;
  schemaVersion: string;
  schemaVersionDate: string;
  stack: Array<{ name: OuterTag; text: string }>;
  versionClosed: boolean;
  versionSeen: boolean;
};

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

function consumeFraming(bytes: Buffer, framing: Framing, actionOccurrences: Map<string, number>) {
  const text = decodeUtf8(bytes);
  const tokens = text.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join("") !== text) throw new ParseFailure("malformed outer XML", bytes);
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      validateXmlCharacters(token, bytes);
      if (framing.prologState === "doctype") {
        const close = token.indexOf("]>");
        if (close < 0) continue;
        if (token.slice(close + 2).trim() !== "") throw new ParseFailure("text after document type", bytes);
        framing.prologState = "after-doctype";
        continue;
      }
      validateXmlEntities(token, bytes);
      const current = framing.stack.at(-1);
      if (current && !["trademark-applications-daily", "version", "application-information", "file-segments", "action-keys"].includes(current.name)) {
        current.text += token;
      } else if (token.trim() !== "") {
        throw new ParseFailure("unexpected outer text", bytes);
      }
      continue;
    }
    if (token.startsWith("<?")) {
      if (
        token === '<?xml version="1.0" encoding="utf-8"?>' &&
        framing.prologState === "start" &&
        framing.stack.length === 0
      ) {
        framing.prologState = "after-xml";
        continue;
      }
      throw new ParseFailure("misplaced XML declaration", bytes);
    }
    if (token.startsWith("<!DOCTYPE")) {
      if (
        !token.startsWith("<!DOCTYPE trademark-applications-daily [") ||
        !["start", "after-xml"].includes(framing.prologState) ||
        framing.stack.length !== 0
      ) {
        throw new ParseFailure("misplaced document type", bytes);
      }
      framing.prologState = token.includes("]>") ? "after-doctype" : "doctype";
      continue;
    }
    if (token.startsWith("<!")) {
      if (framing.prologState !== "doctype") throw new ParseFailure("misplaced declaration", bytes);
      continue;
    }
    const match = token.match(/^<(\/)?([a-z][a-z0-9-]*)>$/);
    if (!match || !outerTags.has(match[2] as OuterTag)) throw new ParseFailure("unsupported outer element", bytes);
    const closing = match[1] === "/";
    const name = match[2] as OuterTag;
    if (closing) {
      const current = framing.stack.pop();
      if (!current || current.name !== name) throw new ParseFailure("mismatched outer tags", bytes);
      const value = current.text.trim();
      if (name === "version-no") framing.schemaVersion = value;
      if (name === "version-date") framing.schemaVersionDate = value;
      if (name === "version") {
        if (framing.schemaVersion === "" || framing.schemaVersionDate === "") throw new ParseFailure("incomplete version", bytes);
        framing.versionClosed = true;
      }
      if (name === "creation-datetime") {
        if (value === "") throw new ParseFailure("missing creation datetime", bytes);
        framing.creationSeen = true;
      }
      if (name === "file-segment") {
        if (value === "") throw new ParseFailure("empty file segment", bytes);
        framing.fileSegmentSeen = true;
      }
      if (name === "action-key") {
        if (value === "") throw new ParseFailure("empty action key", bytes);
        framing.actionKey = value;
        framing.actionKeyCount += 1;
        framing.actionOccurrence = (actionOccurrences.get(value) ?? 0) + 1;
        actionOccurrences.set(value, framing.actionOccurrence);
        framing.actionRecordIndex = 0;
      }
      if (name === "action-keys") {
        if (framing.actionKeyCount !== 1 || framing.actionRecords === 0) {
          throw new ParseFailure("invalid action group", bytes);
        }
      }
      if (name === "file-segments") {
        if (!framing.fileSegmentSeen || framing.recordsSeen === 0) throw new ParseFailure("empty file segments", bytes);
        framing.fileSegmentsClosed = true;
      }
      if (name === "data-available-code") framing.dataAvailableCode = value;
      if (name === "application-information") {
        const noData = framing.dataAvailableCode === "N" && !framing.fileSegmentsSeen;
        const records = framing.fileSegmentsClosed && framing.dataAvailableCode === null;
        if (!noData && !records) throw new ParseFailure("invalid application envelope", bytes);
        framing.applicationClosed = true;
      }
      if (name === "trademark-applications-daily") {
        if (!framing.applicationClosed) throw new ParseFailure("incomplete application envelope", bytes);
        framing.rootClosed = true;
      }
      continue;
    }

    const parent = framing.stack.at(-1)?.name;
    const valid =
      (name === "trademark-applications-daily" &&
        parent === undefined &&
        !framing.rootSeen &&
        ["start", "after-xml", "after-doctype"].includes(framing.prologState)) ||
      (name === "version" && parent === "trademark-applications-daily" && !framing.versionSeen && !framing.creationSeen) ||
      (name === "version-no" && parent === "version" && framing.schemaVersion === "") ||
      (name === "version-date" && parent === "version" && framing.schemaVersion !== "" && framing.schemaVersionDate === "") ||
      (name === "creation-datetime" && parent === "trademark-applications-daily" && framing.versionClosed && !framing.creationSeen) ||
      (name === "application-information" && parent === "trademark-applications-daily" && framing.creationSeen && !framing.applicationSeen) ||
      (name === "file-segments" && parent === "application-information" && !framing.fileSegmentsSeen && framing.dataAvailableCode === null) ||
      (name === "file-segment" && parent === "file-segments" && framing.recordsSeen === 0) ||
      (name === "action-keys" && parent === "file-segments" && framing.fileSegmentSeen) ||
      (name === "action-key" && parent === "action-keys" && framing.actionKeyCount === 0 && framing.actionRecords === 0) ||
      (name === "data-available-code" && parent === "application-information" && !framing.fileSegmentsSeen && framing.dataAvailableCode === null);
    if (!valid) throw new ParseFailure("misnested outer element", bytes);
    if (name === "trademark-applications-daily") {
      framing.rootSeen = true;
      framing.prologState = "body";
    }
    if (name === "version") framing.versionSeen = true;
    if (name === "application-information") framing.applicationSeen = true;
    if (name === "file-segments") framing.fileSegmentsSeen = true;
    if (name === "action-keys") {
      framing.actionKey = "";
      framing.actionKeyCount = 0;
      framing.actionRecords = 0;
    }
    framing.stack.push({ name, text: "" });
  }
}

export function createSourceObservationModule(database: postgres.Sql) {
  return {
    async stageArtifact(input: StageInput): Promise<ParseResult> {
      const [artifactVersion] = await database<Array<ParseRunRow & { productId: string }>>`
        select a.product_id as "productId", r.id as "parseRunId", r.state, r.digest,
          r.record_count as "recordCount", r.reject_count as "rejectCount"
        from artifact_version v
        join artifact a on a.id = v.artifact_id
        left join parse_run r on r.artifact_version_id = v.id and r.parser_version = ${parserVersion}
        where v.id = ${input.artifactVersionId}
      `;
      if (!artifactVersion) throw new Error("Artifact version not found");
      const existingResult = terminalParseResult(artifactVersion);
      if (existingResult) return existingResult;
      if (artifactVersion.state === "parsing") throw new Error("Parse run already in progress");
      const parseRunId = randomUUID();
      const digest = createHash("sha256");
      let recordCount = 0;
      let pending = Buffer.alloc(0);
      let recordOpen = false;
      const framing: Framing = {
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
        recordsSeen: 0,
        prologState: "start",
        rootSeen: false,
        rootClosed: false,
        schemaVersion: "",
        schemaVersionDate: "",
        stack: [],
        versionClosed: false,
        versionSeen: false,
      };
      const actionOccurrences = new Map<string, number>();

      try {
        return await database.begin(async (transaction) => {
          const [inserted] = await transaction<Array<{ id: string }>>`
            insert into parse_run (id, artifact_version_id, parser_version)
            values (${parseRunId}, ${input.artifactVersionId}, ${parserVersion})
            on conflict (artifact_version_id, parser_version) do nothing
            returning id
          `;
          if (!inserted) {
            const [concurrentRun] = await transaction<ParseRunRow[]>`
              select id as "parseRunId", state, digest, record_count as "recordCount",
                reject_count as "rejectCount"
              from parse_run
              where artifact_version_id = ${input.artifactVersionId} and parser_version = ${parserVersion}
            `;
            if (!concurrentRun) throw new Error("Concurrent parse run disappeared");
            const concurrentResult = terminalParseResult(concurrentRun);
            if (concurrentResult) return concurrentResult;
            throw new Error("Parse run already in progress");
          }
          await transaction`update artifact_version set state = 'parsing' where id = ${input.artifactVersionId}`;

          const recordRows: Array<{
            id: string;
            parse_run_id: string;
            physical_record_index: number;
            action_key: string;
            action_occurrence: number;
            action_record_index: number;
            serial_number: string;
            source_transaction_date: string | null;
            source_transaction_date_raw: string | null;
            schema_version: string;
            schema_version_date: string;
            profile: string;
            digest: string;
            values: SourceValue[];
          }> = [];
          const claimRows: Array<{
            id: string;
            source_record_id: string;
            claim_order: number;
            path: string;
            occurrence: number;
            presence: SourceValue["presence"];
            operation: ClaimOperation;
            raw_value: string | null;
          }> = [];

          const flush = async () => {
            if (recordRows.length === 0) return;
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
                "values",
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
                  "raw_value",
                )}
              `;
            }
            recordRows.length = 0;
            claimRows.length = 0;
          };

          const persistRecord = async (raw: Buffer) => {
            recordCount += 1;
            if (framing.stack.at(-1)?.name !== "action-keys" || framing.actionKeyCount !== 1) {
              throw new ParseFailure("case-file outside action group", raw, recordCount);
            }
            framing.actionRecordIndex += 1;
            framing.actionRecords += 1;
            framing.recordsSeen += 1;
            const physicalRecordIndex = recordCount;
            if (!framing.rootSeen || framing.schemaVersion !== "2.0" || framing.schemaVersionDate !== "20041108") {
              throw new ParseFailure("unsupported root or schema version", raw, physicalRecordIndex);
            }
            let root: XmlNode;
            try {
              root = parseRecord(raw);
            } catch (error) {
              if (error instanceof ParseFailure) throw new ParseFailure(error.reason, raw, physicalRecordIndex);
              throw error;
            }
            let serialNumber: string;
            try {
              serialNumber = scalar(root, "serial-number", raw)?.trim() ?? "";
            } catch (error) {
              if (error instanceof ParseFailure) throw new ParseFailure(error.reason, raw, physicalRecordIndex);
              throw error;
            }
            if (!/^\d+$/.test(serialNumber)) throw new ParseFailure("missing mandatory case identity", raw, physicalRecordIndex);
            const profile = profileRecord(root, artifactVersion.productId, framing.actionKey);
            if (!profile) throw new ParseFailure("unsupported source shape", raw, physicalRecordIndex);
            const sourceTransactionDateRaw = scalar(root, "transaction-date", raw);
            const sourceTransactionDate = parseDate(sourceTransactionDateRaw);
            const sourceRecordId = randomUUID();
            const values = [toSourceValue(root)];
            validateScalarUniqueness(root, raw);
            const claims = claimsFrom(root, profile);
            recordRows.push({
              id: sourceRecordId,
              parse_run_id: parseRunId,
              physical_record_index: physicalRecordIndex,
              action_key: framing.actionKey,
              action_occurrence: framing.actionOccurrence,
              action_record_index: framing.actionRecordIndex,
              serial_number: serialNumber,
              source_transaction_date: sourceTransactionDate,
              source_transaction_date_raw: sourceTransactionDateRaw,
              schema_version: framing.schemaVersion,
              schema_version_date: framing.schemaVersionDate,
              profile,
              digest: createHash("sha256").update(raw).digest("hex"),
              values,
            });
            claimRows.push(
              ...claims.map((claim, claimOrder) => ({
                id: randomUUID(),
                source_record_id: sourceRecordId,
                claim_order: claimOrder + 1,
                path: claim.path,
                occurrence: claim.occurrence,
                presence: claim.presence,
                operation: claim.operation,
                raw_value: claim.rawValue,
              })),
            );
            if (recordRows.length === recordBatchSize) await flush();
          };

          for await (const chunk of input.xml) {
            digest.update(chunk);
            for (let offset = 0; offset < chunk.byteLength; offset += inputSliceBytes) {
              pending = Buffer.concat([pending, Buffer.from(chunk.subarray(offset, offset + inputSliceBytes))]);
              while (true) {
                if (!recordOpen) {
                  const start = pending.indexOf(recordStart);
                  if (start < 0) {
                    if (pending.byteLength <= 2048) break;
                    const boundary = pending.lastIndexOf(62, pending.byteLength - 1024) + 1;
                    if (boundary <= 0) break;
                    const consumed = pending.subarray(0, boundary);
                    consumeFraming(consumed, framing, actionOccurrences);
                    pending = pending.subarray(boundary);
                    continue;
                  }
                  const previousNewline = pending.lastIndexOf(10, start - 1);
                  const lineStart = previousNewline < 0 ? 0 : previousNewline + 1;
                  consumeFraming(pending.subarray(0, lineStart), framing, actionOccurrences);
                  pending = pending.subarray(lineStart);
                  recordOpen = true;
                }
                const start = pending.indexOf(recordStart);
                const end = pending.indexOf(recordEnd, start + recordStart.byteLength);
                const nested = pending.indexOf(recordStart, start + recordStart.byteLength);
                if (nested >= 0 && (end < 0 || nested < end)) {
                  throw new ParseFailure("ambiguous record boundaries", pending, recordCount + 1);
                }
                if (end < 0) {
                  if (pending.byteLength > maxRecordBytes) {
                    throw new ParseFailure(`record exceeds ${maxRecordBytes} byte limit`, pending, recordCount + 1);
                  }
                  break;
                }
                const closeEnd = end + recordEnd.byteLength;
                const followingNewline = pending.indexOf(10, closeEnd);
                if (followingNewline < 0) {
                  if (closeEnd > maxRecordBytes) {
                    throw new ParseFailure(
                      `record exceeds ${maxRecordBytes} byte limit`,
                      pending.subarray(0, closeEnd),
                      recordCount + 1,
                    );
                  }
                  break;
                }
                const recordBytes = pending.subarray(0, followingNewline + 1);
                if (recordBytes.byteLength > maxRecordBytes) {
                  throw new ParseFailure(`record exceeds ${maxRecordBytes} byte limit`, recordBytes, recordCount + 1);
                }
                pending = pending.subarray(followingNewline + 1);
                recordOpen = false;
                await persistRecord(recordBytes);
              }
            }
          }
          if (recordOpen || pending.includes(recordStart)) {
            const actionClose = pending.indexOf(Buffer.from("</action-keys>"));
            const rejected = actionClose < 0 ? pending : pending.subarray(0, actionClose);
            throw new ParseFailure("malformed or truncated XML", rejected, recordCount + 1);
          }
          consumeFraming(pending, framing, actionOccurrences);
          if (
            !framing.rootSeen ||
            !framing.rootClosed ||
            framing.stack.length !== 0 ||
            framing.schemaVersion !== "2.0" ||
            framing.schemaVersionDate !== "20041108"
          ) {
            throw new ParseFailure("unsupported root or schema version", pending);
          }
          await flush();
          const runDigest = digest.digest("hex");
          await transaction`
            update parse_run set state = 'staged', digest = ${runDigest}, record_count = ${recordCount},
              finished_at = now() where id = ${parseRunId}
          `;
          await transaction`update artifact_version set state = 'staged' where id = ${input.artifactVersionId}`;
          return { digest: runDigest, parseRunId, recordCount, rejectCount: 0, status: "staged" };
        });
      } catch (error) {
        if (!(error instanceof ParseFailure)) throw error;
        const rawXml = error.rawXml;
        const runDigest = digest.copy().digest("hex");
        return await database.begin(async (transaction) => {
          const [inserted] = await transaction<Array<{ id: string }>>`
            insert into parse_run (
              id, artifact_version_id, state, parser_version, digest, record_count, reject_count, finished_at
            ) values (
              ${parseRunId}, ${input.artifactVersionId}, 'quarantined', ${parserVersion}, ${runDigest}, 0, 1, now()
            )
            on conflict (artifact_version_id, parser_version) do nothing
            returning id
          `;
          if (!inserted) {
            const [winner] = await transaction<ParseRunRow[]>`
              select id as "parseRunId", state, digest, record_count as "recordCount",
                reject_count as "rejectCount"
              from parse_run
              where artifact_version_id = ${input.artifactVersionId} and parser_version = ${parserVersion}
            `;
            if (!winner) throw new Error("Concurrent parse run disappeared");
            const winnerResult = terminalParseResult(winner);
            if (winnerResult) return winnerResult;
            throw new Error("Parse run already in progress");
          }
          await transaction`
            insert into parse_reject (id, parse_run_id, physical_record_index, reason, raw_xml, bytes, digest)
            values (
              ${randomUUID()}, ${parseRunId}, ${error.physicalRecordIndex}, ${error.reason}, ${rawXml},
              ${rawXml.byteLength}, ${createHash("sha256").update(rawXml).digest("hex")}
            )
          `;
          await transaction`update artifact_version set state = 'quarantined' where id = ${input.artifactVersionId}`;
          return { digest: runDigest, parseRunId, recordCount: 0, rejectCount: 1, status: "quarantined" };
        });
      }
    },

    async *readRecords(parseRunId: string): AsyncIterable<SourceObservation> {
      const query = database<
        Array<SourceObservation>
      >`
        select action_key as "actionKey", action_occurrence as "actionOccurrence",
          action_record_index as "actionRecordIndex", digest, physical_record_index as "physicalRecordIndex",
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
        left join source_claim c on c.source_record_id = r.id
        where r.parse_run_id = ${parseRunId}
        group by r.id
        order by physical_record_index
      `;
      for await (const batch of query.cursor(100)) {
        for (const record of batch) yield record;
      }
    },

    async *readRejects(parseRunId: string): AsyncIterable<SourceReject> {
      const query = database<SourceReject[]>`
        select bytes, digest, physical_record_index as "physicalRecordIndex", raw_xml as "rawXml", reason
        from parse_reject where parse_run_id = ${parseRunId} order by created_at, id
      `;
      for await (const batch of query.cursor(100)) {
        for (const reject of batch) yield reject;
      }
    },
  };
}
