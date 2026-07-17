import { createHash } from "node:crypto";
import { type Readable, Transform } from "node:stream";

import flow from "xml-flow";

const compactDate = /^\d{8}$/;
const serialNumber = /^\d{8}$/;
const zeroes = /^0+$/;
const registrationNumber = /^\d{1,7}$/;
const batchSize = 100;
const annualRoot = "trademark-applications-daily";
const annualVersion = "2.0";
const annualVersionDate = "20041108";
const maxRootPrefixBytes = 64 * 1024;
const rootElement = /^<([A-Za-z_][\w.:-]*)(?=[\s/>])/;
const rootWhitespace = /^\s*/;

interface SourceCoordinate {
  filename: string;
  physicalRecordIndex: number;
  product: "TRTYRAP";
  sha256: string;
}

export interface AnnualMarkProjection {
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
  sourceTransactionDate: string | null;
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

interface AnnualProjectionResult {
  physicalRecordCount: number;
  projectedMarkCount: number;
}

export function streamAnnualProjections(options: {
  coordinate: Omit<SourceCoordinate, "physicalRecordIndex">;
  onBatch: (batch: AnnualMarkProjection[]) => Promise<void>;
  xml: Readable;
}): Promise<AnnualProjectionResult> {
  return new Promise((resolve, reject) => {
    const validatedXml = validateAnnualRoot(options.xml);
    const parser = flow(validatedXml, {
      lowercase: true,
      normalize: false,
      preserveMarkup: flow.NEVER,
      simplifyNodes: true,
      strict: true,
      trim: true,
      useArrays: flow.ALWAYS,
    }) as ReturnType<typeof flow> & { pause: () => void; resume: () => void };
    let actionKey: string | null = null;
    let physicalRecordCount = 0;
    let projectedMarkCount = 0;
    let failed = false;
    let pending: AnnualMarkProjection[] = [];
    let versionCount = 0;
    let versionDateCount = 0;
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
      writes = writes.then(() => options.onBatch(batch)).then(() => parser.resume());
      writes.catch(fail);
    };

    parser.on("tag:version-no", (value) => {
      versionCount += 1;
      if (versionCount !== 1) {
        fail(new Error("version-no must occur exactly once"));
        return;
      }
      if (scalar(value, "version-no") !== annualVersion) {
        fail(new Error("Unsupported USPTO XML version"));
      }
    });
    parser.on("tag:version-date", (value) => {
      versionDateCount += 1;
      if (versionDateCount !== 1) {
        fail(new Error("version-date must occur exactly once"));
        return;
      }
      if (scalar(value, "version-date") !== annualVersionDate) {
        fail(new Error("Unsupported USPTO XML version date"));
      }
    });
    parser.on("tag:action-key", (value) => {
      actionKey = scalar(value, "action-key");
    });
    parser.on("tag:case-file", (value) => {
      if (failed) {
        return;
      }
      try {
        physicalRecordCount += 1;
        assertDocumentVersion(versionCount, versionDateCount, " before records");
        if (actionKey !== "TX") {
          throw new Error(`Unsupported annual action key: ${actionKey ?? "missing"}`);
        }
        const projection = projectRecord(value, {
          ...options.coordinate,
          physicalRecordIndex: physicalRecordCount,
        });
        if (!projection) {
          return;
        }
        projectedMarkCount += 1;
        pending.push(projection);
        if (pending.length >= batchSize) {
          flush();
        }
      } catch (error) {
        fail(
          new Error(
            `Annual record ${physicalRecordCount} is invalid: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    });
    parser.on("error", fail);
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
            resolve({ physicalRecordCount, projectedMarkCount });
          }
        })
        .catch(fail);
    });
  });
}

function validateAnnualRoot(xml: Readable) {
  let prefix = Buffer.alloc(0);
  let validated = false;
  const validator = new Transform({
    flush(callback) {
      callback(validated ? undefined : new Error(`Annual XML root must be ${annualRoot}`));
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
          callback(new Error(`Annual XML root must occur within ${maxRootPrefixBytes} bytes`));
          return;
        }
        prefix = inspected;
        callback();
        return;
      }
      if (root !== annualRoot) {
        callback(new Error(`Annual XML root must be ${annualRoot}`));
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

function projectRecord(value: unknown, coordinate: SourceCoordinate): AnnualMarkProjection | null {
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
  if (
    !(
      wordMark &&
      classes.some((item) => optionalScalar(item["primary-code"], "primary-code")?.trim() === "025")
    )
  ) {
    return null;
  }
  const projectedClasses = classes.flatMap((item) => {
    const internationalCodes = optionalScalars(item["international-code"], "international-code");
    const projection = {
      statusCode: optionalScalar(item["status-code"], "class status-code"),
      statusDate: parseDate(
        optionalScalar(item["status-date"], "class status-date"),
        "class status-date"
      ),
    };
    return (internationalCodes.length === 0 ? [null] : internationalCodes).map(
      (internationalCode) => ({ internationalCode, ...projection })
    );
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
  return {
    classes: projectedClasses,
    coordinate,
    filingDate: parseDate(optionalScalar(header["filing-date"], "filing-date"), "filing-date"),
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
    sourceTransactionDate: parseDate(
      optionalScalar(record["transaction-date"], "transaction-date"),
      "transaction-date"
    ),
    statusCode: optionalScalar(header["status-code"], "status-code"),
    statusDate: parseDate(optionalScalar(header["status-date"], "status-date"), "status-date"),
    statusEvents: [...statusEvents.values()],
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
    throw new Error(`version-no must occur exactly once${context}`);
  }
  if (versionDateCount !== 1) {
    throw new Error(`version-date must occur exactly once${context}`);
  }
}
