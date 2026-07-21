import { createHash } from "node:crypto";
import { type Readable, Transform } from "node:stream";

import flow from "xml-flow";

const compactDate = /^\d{8}$/;
const serialNumber = /^\d{8}$/;
const zeroes = /^0+$/;
const registrationNumber = /^\d{1,7}$/;
const batchSize = 250;
const documentRoot = "trademark-applications-daily";
const sourceVersion = "2.0";
const sourceVersionDate = "20041108";
const maxRootPrefixBytes = 64 * 1024;
const rootElement = /^<([A-Za-z_][\w.:-]*)(?=[\s/>])/;
const rootWhitespace = /^\s*/;

export type SourceProduct = "TRTDXFAP" | "TRTYRAP";

interface SourceCoordinate {
  contentRevision: number;
  filename: string;
  parserVersion: string;
  physicalRecordIndex: number;
  product: SourceProduct;
  sha256: string;
}

export interface MarkUpsertProjection {
  classes: Array<{
    internationalCode: string | null;
    statusCode: string | null;
    statusDate: string | null;
  }>;
  coordinate: SourceCoordinate;
  filingDate: string | null;
  goodsServices: Array<{ text: string | null; typeCode: string | null }>;
  markDrawingCode: string | null;
  owners: Array<{ entryNumber: string | null; partyName: string | null; partyType: string | null }>;
  registrationDate: string | null;
  registrationNumber: string | null;
  serialNumber: string;
  snapshotHash: string;
  sourceTransactionDate: string;
  statusCode: string | null;
  statusDate: string | null;
  statusEvents: Array<{
    code: string | null;
    date: string | null;
    description: string | null;
    eventKey: string;
    number: string | null;
    type: string | null;
  }>;
  wordMark: string;
}

export interface MarkObservationProjection {
  coordinate: SourceCoordinate;
  kind: "observe";
  serialNumber: string;
  snapshotHash: string;
  sourceTransactionDate: string;
}

export type TrademarkProjection =
  | (MarkUpsertProjection & { kind: "upsert" })
  | MarkObservationProjection;

export interface ProjectionBatchResult {
  appliedRecordCount: number;
  firstError: string | null;
  materialChangeCount: number;
  unresolvedRecordCount: number;
}

export interface TrademarkProjectionResult extends ProjectionBatchResult {
  physicalRecordCount: number;
  projectedMarkCount: number;
}

export class TrademarkSourceError extends Error {}

export function streamTrademarkProjections(options: {
  coordinate: Omit<SourceCoordinate, "physicalRecordIndex">;
  onBatch: (batch: TrademarkProjection[]) => Promise<ProjectionBatchResult>;
  xml: Readable;
}): Promise<TrademarkProjectionResult> {
  return new Promise((resolve, reject) => {
    const validatedXml = validateTrademarkRoot(options.xml);
    const parser = flow(validatedXml, {
      lowercase: true,
      normalize: false,
      preserveMarkup: flow.NEVER,
      simplifyNodes: true,
      strict: true,
      trim: true,
      useArrays: flow.ALWAYS,
    }) as ReturnType<typeof flow> & { pause: () => void; resume: () => void };
    let physicalRecordCount = 0;
    let projectedMarkCount = 0;
    let failed = false;
    let firstError: string | null = null;
    let appliedRecordCount = 0;
    let materialChangeCount = 0;
    let pending: TrademarkProjection[] = [];
    let versionCount = 0;
    let versionDateCount = 0;
    let unresolvedRecordCount = 0;
    let writes = Promise.resolve();

    const fail = (error: unknown) => {
      if (failed) {
        return;
      }
      failed = true;
      options.xml.unpipe();
      options.xml.destroy();
      validatedXml.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const flush = () => {
      if (pending.length === 0) {
        return;
      }
      const batch = pending;
      pending = [];
      parser.pause();
      writes = writes
        .then(() => options.onBatch(batch))
        .then((result) => {
          appliedRecordCount += result.appliedRecordCount;
          firstError ??= result.firstError;
          materialChangeCount += result.materialChangeCount;
          unresolvedRecordCount += result.unresolvedRecordCount;
          parser.resume();
        });
      writes.catch(fail);
    };
    const projectCaseFile = (value: unknown) => {
      physicalRecordCount += 1;
      const projection = projectRecord(value, {
        ...options.coordinate,
        physicalRecordIndex: physicalRecordCount,
      });
      if (!projection) {
        return;
      }
      if (projection.kind === "upsert") {
        projectedMarkCount += 1;
      }
      pending.push(projection);
      if (pending.length >= batchSize) {
        flush();
      }
    };

    parser.on("tag:version-no", (value) => {
      versionCount += 1;
      if (versionCount !== 1) {
        fail(new TrademarkSourceError("version-no must occur exactly once"));
        return;
      }
      if (scalar(value, "version-no") !== sourceVersion) {
        fail(new TrademarkSourceError("Unsupported USPTO XML version"));
      }
    });
    parser.on("tag:version-date", (value) => {
      versionDateCount += 1;
      if (versionDateCount !== 1) {
        fail(new TrademarkSourceError("version-date must occur exactly once"));
        return;
      }
      if (scalar(value, "version-date") !== sourceVersionDate) {
        fail(new TrademarkSourceError("Unsupported USPTO XML version date"));
      }
    });
    parser.on("tag:case-file", (value) => {
      if (failed) {
        return;
      }
      try {
        assertDocumentVersion(versionCount, versionDateCount, " before records");
      } catch (error) {
        fail(error);
        return;
      }
      try {
        projectCaseFile(value);
      } catch (error) {
        const message = `Trademark record ${physicalRecordCount} is invalid: ${error instanceof Error ? error.message : String(error)}`;
        firstError ??= message;
        unresolvedRecordCount += 1;
      }
    });
    parser.on("error", (error) => fail(asTrademarkSourceError(error)));
    validatedXml.on("error", fail);
    options.xml.on("error", fail);
    parser.on("end", () => {
      if (failed) {
        return;
      }
      try {
        assertDocumentVersion(versionCount, versionDateCount);
      } catch (error) {
        fail(error);
        return;
      }
      flush();
      writes
        .then(() => {
          if (!failed) {
            resolve({
              appliedRecordCount,
              firstError,
              materialChangeCount,
              physicalRecordCount,
              projectedMarkCount,
              unresolvedRecordCount,
            });
          }
        })
        .catch(fail);
    });
  });
}

function validateTrademarkRoot(xml: Readable) {
  let prefix = Buffer.alloc(0);
  let validated = false;
  const validator = new Transform({
    flush(callback) {
      callback(
        validated
          ? undefined
          : new TrademarkSourceError(`Trademark XML root must be ${documentRoot}`)
      );
    },
    transform(chunk: Buffer, _encoding, callback) {
      if (validated) {
        callback(null, chunk);
        return;
      }
      const remaining = maxRootPrefixBytes - prefix.length;
      const inspected = Buffer.concat([prefix, chunk.subarray(0, Math.max(remaining, 0))]);
      const root = rootElementName(inspected.toString("utf8"));
      if (root === null) {
        if (chunk.length > remaining || inspected.length >= maxRootPrefixBytes) {
          callback(
            new TrademarkSourceError(
              `Trademark XML root must occur within ${maxRootPrefixBytes} bytes`
            )
          );
          return;
        }
        prefix = inspected;
        callback();
        return;
      }
      if (root !== documentRoot) {
        callback(new TrademarkSourceError(`Trademark XML root must be ${documentRoot}`));
        return;
      }
      validated = true;
      callback(null, prefix.length === 0 ? chunk : Buffer.concat([prefix, chunk]));
      prefix = Buffer.alloc(0);
    },
  });
  xml.pipe(validator);
  return validator;
}

function rootElementName(prefix: string): string | null {
  let offset = prefix.startsWith("\uFEFF") ? 1 : 0;
  while (offset < prefix.length) {
    const whitespace = rootWhitespace.exec(prefix.slice(offset))?.[0].length ?? 0;
    offset += whitespace;
    if (prefix.startsWith("<?", offset)) {
      const end = prefix.indexOf("?>", offset + 2);
      if (end < 0) {
        return null;
      }
      offset = end + 2;
      continue;
    }
    if (prefix.startsWith("<!--", offset)) {
      const end = prefix.indexOf("-->", offset + 4);
      if (end < 0) {
        return null;
      }
      offset = end + 3;
      continue;
    }
    if (prefix.startsWith("<!DOCTYPE", offset)) {
      const end = documentTypeEnd(prefix, offset + "<!DOCTYPE".length);
      if (end === null) {
        return null;
      }
      offset = end;
      continue;
    }
    const match = rootElement.exec(prefix.slice(offset));
    return match?.[1] ?? null;
  }
  return null;
}

function documentTypeEnd(prefix: string, start: number): number | null {
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;
  for (let offset = start; offset < prefix.length; offset += 1) {
    if (quote) {
      if (prefix[offset] === quote) {
        quote = null;
      }
      continue;
    }
    const afterComment = internalCommentEnd(prefix, offset);
    if (afterComment === null) {
      return null;
    }
    if (afterComment !== offset) {
      offset = afterComment - 1;
      continue;
    }
    const character = prefix[offset];
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") {
      bracketDepth += 1;
      continue;
    }
    if (character === "]") {
      bracketDepth -= 1;
      continue;
    }
    if (character === ">" && bracketDepth === 0) {
      return offset + 1;
    }
  }
  return null;
}

function internalCommentEnd(prefix: string, offset: number): number | null {
  if (!prefix.startsWith("<!--", offset)) {
    return offset;
  }
  const end = prefix.indexOf("-->", offset + 4);
  return end < 0 ? null : end + 3;
}

function projectRecord(value: unknown, coordinate: SourceCoordinate): TrademarkProjection | null {
  const record = object(value, "case-file");
  const serial = scalar(record["serial-number"], "serial-number");
  if (!serialNumber.test(serial)) {
    throw new Error("serial-number must contain eight digits");
  }
  const headers = objects(record["case-file-header"]);
  if (headers.length !== 1) {
    throw new Error("case-file-header must occur once");
  }
  const header = headers[0] as Record<string, unknown>;
  const wordMark = optionalScalar(header["mark-identification"], "mark-identification")?.trim();
  const classes = objects(record.classifications);
  const filingDate = parseDate(optionalScalar(header["filing-date"], "filing-date"), "filing-date");
  const sourceTransactionDate = parseDate(
    optionalScalar(record["transaction-date"], "transaction-date"),
    "transaction-date"
  );
  if (sourceTransactionDate === null) {
    throw new Error("transaction-date is missing");
  }
  const projectedClasses = classes.flatMap((item) => {
    const internationalCodes = optionalScalars(item["international-code"], "international-code");
    const primaryClassFallback =
      internationalCodes.length === 0 &&
      filingDate !== null &&
      filingDate >= "1973-09-01" &&
      optionalScalar(item["primary-code"], "primary-code")?.trim() === "025";
    const projection = {
      statusCode: optionalScalar(item["status-code"], "class status-code"),
      statusDate: parseDate(
        optionalScalar(item["status-date"], "class status-date"),
        "class status-date"
      ),
    };
    return (
      internationalCodes.length === 0 ? [primaryClassFallback ? "025" : null] : internationalCodes
    ).map((internationalCode) => ({ internationalCode, ...projection }));
  });
  const goodsServices = objects(record["case-file-statements"]).map((item) => ({
    text: optionalScalar(item.text, "statement text"),
    typeCode: optionalScalar(item["type-code"], "statement type-code"),
  }));
  const owners = objects(record["case-file-owners"]).map((item) => ({
    entryNumber: optionalScalar(item["entry-number"], "owner entry-number"),
    partyName: optionalScalar(item["party-name"], "owner party-name"),
    partyType: optionalScalar(item["party-type"], "owner party-type"),
  }));
  const statusEvents = new Map(
    objects(record["case-file-event-statements"]).map((item) => {
      const event = {
        code: optionalScalar(item.code, "event code"),
        date: parseDate(optionalScalar(item.date, "event date"), "event date"),
        description: optionalScalar(item["description-text"], "event description"),
        number: optionalScalar(item.number, "event number"),
        type: optionalScalar(item.type, "event type"),
      };
      const eventKey = createHash("sha256").update(JSON.stringify(event)).digest("hex");
      return [eventKey, { ...event, eventKey }] as const;
    })
  );
  const selected = projectedClasses.some((item) => item.internationalCode?.trim() === "025");
  const snapshot = {
    classes: projectedClasses,
    filingDate,
    goodsServices,
    markDrawingCode: optionalScalar(header["mark-drawing-code"], "mark-drawing-code"),
    owners,
    registrationDate: parseDate(
      optionalScalar(header["registration-date"], "registration-date"),
      "registration-date"
    ),
    registrationNumber: parseRegistrationNumber(
      optionalScalar(record["registration-number"], "registration-number")
    ),
    serialNumber: serial,
    sourceTransactionDate,
    statusCode: optionalScalar(header["status-code"], "status-code"),
    statusDate: parseDate(optionalScalar(header["status-date"], "status-date"), "status-date"),
    statusEvents: [...statusEvents.values()],
    wordMark: wordMark ?? null,
  };
  const canonicalStatusEvents = [...statusEvents.values()].sort((left, right) =>
    left.eventKey.localeCompare(right.eventKey)
  );
  const snapshotHash = createHash("sha256")
    .update(
      JSON.stringify({
        ...snapshot,
        statusEvents: canonicalStatusEvents,
        trackedClassSelected: selected,
      })
    )
    .digest("hex");
  if (!(selected && wordMark)) {
    return {
      coordinate,
      kind: "observe",
      serialNumber: serial,
      snapshotHash,
      sourceTransactionDate,
    };
  }
  return {
    ...snapshot,
    coordinate,
    kind: "upsert",
    snapshotHash,
    wordMark,
  };
}

function object(value: unknown, name: string) {
  const matches = objects(value);
  if (matches.length !== 1) {
    throw new Error(`${name} must occur once`);
  }
  return matches[0] as Record<string, unknown>;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(objects);
  }
  if (value && typeof value === "object") {
    return [value as Record<string, unknown>];
  }
  return [];
}

function scalar(value: unknown, name: string) {
  const result = optionalScalar(value, name);
  if (result === null) {
    throw new Error(`${name} is missing`);
  }
  return result;
}

function optionalScalar(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new Error(`${name} must occur at most once`);
    }
    return optionalScalar(value[0], name);
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object" && "$text" in value) {
    return optionalScalar((value as { $text: unknown }).$text, name);
  }
  throw new Error(`${name} must be scalar`);
}

function optionalScalars(value: unknown, name: string) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => optionalScalar(item, name))
    .filter((item): item is string => item !== null);
}

function parseDate(value: string | null, name: string) {
  if (!value || zeroes.test(value)) {
    return null;
  }
  if (!compactDate.test(value)) {
    return null;
  }
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Error(`${name} is not a calendar date`);
  }
  return iso;
}

function parseRegistrationNumber(value: string | null) {
  if (!value || zeroes.test(value)) {
    return null;
  }
  if (!registrationNumber.test(value)) {
    throw new Error("registration-number must contain at most seven digits");
  }
  return value.padStart(7, "0");
}

function assertDocumentVersion(versionCount: number, versionDateCount: number, context = "") {
  if (versionCount !== 1) {
    throw new TrademarkSourceError(`version-no must occur exactly once${context}`);
  }
  if (versionDateCount !== 1) {
    throw new TrademarkSourceError(`version-date must occur exactly once${context}`);
  }
}

function asTrademarkSourceError(error: unknown) {
  if (error instanceof TrademarkSourceError) {
    return error;
  }
  return new TrademarkSourceError(error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}
