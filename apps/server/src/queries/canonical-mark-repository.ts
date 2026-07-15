import { createHash } from "node:crypto";
import type postgres from "postgres";

import type {
  CanonicalClass,
  CanonicalGoodsServices,
  CanonicalOwner,
  CanonicalStatusEvent,
  Contributor,
  ResolvedCanonicalMark,
} from "../ingestion/canonical-marks.ts";

type MarkRow = ResolvedCanonicalMark["mark"] & {
  authorityPolicy: string;
  normalization: string;
  projection: string;
  sourceProfile: string;
};
type Database = postgres.Sql | postgres.TransactionSql;

function eventKey(event: CanonicalStatusEvent) {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

async function replaceCanonicalMark(database: Database, materialization: ResolvedCanonicalMark) {
  const { mark, versions } = materialization;
  await database`
    insert into mark (
      serial_number, registration_number, word_mark, mark_drawing_code, filing_date, registration_date,
      status_code, status_date, source_transaction_date, normalization_version, source_profile_version,
      projection_version, authority_policy_version
    ) values (
      ${mark.serialNumber}, ${mark.registrationNumber}, ${mark.wordMark}, ${mark.markDrawingCode}, ${mark.filingDate},
      ${mark.registrationDate}, ${mark.statusCode}, ${mark.statusDate}, ${mark.sourceTransactionDate},
      ${versions.normalization}, ${versions.sourceProfile}, ${versions.projection}, ${versions.authorityPolicy}
    )
    on conflict (serial_number) do update set
      registration_number = excluded.registration_number,
      word_mark = excluded.word_mark,
      mark_drawing_code = excluded.mark_drawing_code,
      filing_date = excluded.filing_date,
      registration_date = excluded.registration_date,
      status_code = excluded.status_code,
      status_date = excluded.status_date,
      source_transaction_date = excluded.source_transaction_date,
      normalization_version = excluded.normalization_version,
      source_profile_version = excluded.source_profile_version,
      projection_version = excluded.projection_version,
      authority_policy_version = excluded.authority_policy_version
  `;
  await database`delete from mark_class where serial_number = ${mark.serialNumber}`;
  await database`delete from mark_goods_services where serial_number = ${mark.serialNumber}`;
  await database`delete from mark_owner where serial_number = ${mark.serialNumber}`;
  await database`delete from mark_status_event where serial_number = ${mark.serialNumber}`;
  await database`delete from mark_group_contributor where serial_number = ${mark.serialNumber}`;

  if (materialization.classes.length > 0) {
    await database`
      insert into mark_class ${database(materialization.classes.map((item, index) => ({
        serial_number: mark.serialNumber,
        ordinal: index + 1,
        international_code: item.internationalCode,
        status_code: item.statusCode,
        status_date: item.statusDate,
      })))}
    `;
  }
  if (materialization.goodsServices.length > 0) {
    await database`
      insert into mark_goods_services ${database(materialization.goodsServices.map((item, index) => ({
        serial_number: mark.serialNumber,
        ordinal: index + 1,
        type_code: item.typeCode,
        text: item.text,
      })))}
    `;
  }
  if (materialization.owners.length > 0) {
    await database`
      insert into mark_owner ${database(materialization.owners.map((item, index) => ({
        serial_number: mark.serialNumber,
        ordinal: index + 1,
        entry_number: item.entryNumber,
        party_name: item.partyName,
        party_type: item.partyType,
      })))}
    `;
  }
  if (materialization.statusEvents.length > 0) {
    await database`
      insert into mark_status_event ${database(materialization.statusEvents.map((item) => ({
        serial_number: mark.serialNumber,
        event_key: eventKey(item),
        code: item.code,
        type: item.type,
        description: item.description,
        event_date: item.date,
        event_number: item.number,
      })))}
    `;
  }
  if (materialization.contributors.length > 0) {
    await database`
      insert into mark_group_contributor ${database(materialization.contributors.map((item) => ({
        serial_number: mark.serialNumber,
        group_name: item.group,
        claim_path: item.claimPath,
        product: item.product,
        artifact_version_sha256: item.artifactVersionSha256,
        physical_record_index: item.physicalRecordIndex,
      })))}
    `;
  }
}

const completeCollectionGroups = new Set(["classes", "goods-services", "owners"]);

async function readCanonicalStates(database: Database, serialNumbers: string[]) {
  if (serialNumbers.length === 0) return new Map<string, unknown>();
  const states = await database<Array<{ serialNumber: string; state: unknown }>>`
    select m.serial_number as "serialNumber", jsonb_build_object(
      'mark', to_jsonb(m),
      'classes', coalesce((select jsonb_agg(to_jsonb(c) order by c.ordinal) from mark_class c
        where c.serial_number = m.serial_number), '[]'::jsonb),
      'goodsServices', coalesce((select jsonb_agg(to_jsonb(g) order by g.ordinal) from mark_goods_services g
        where g.serial_number = m.serial_number), '[]'::jsonb),
      'owners', coalesce((select jsonb_agg(to_jsonb(o) order by o.ordinal) from mark_owner o
        where o.serial_number = m.serial_number), '[]'::jsonb),
      'statusEvents', coalesce((select jsonb_agg(to_jsonb(e) order by e.event_key) from mark_status_event e
        where e.serial_number = m.serial_number), '[]'::jsonb),
      'contributors', coalesce((select jsonb_agg(to_jsonb(c) order by c.group_name, c.claim_path, c.product,
        c.artifact_version_sha256, c.physical_record_index) from mark_group_contributor c
        where c.serial_number = m.serial_number), '[]'::jsonb)
    ) as state
    from mark m
    where m.serial_number in ${database(serialNumbers)}
  `;
  return new Map(states.map((row) => [row.serialNumber, row.state]));
}

export async function publishCanonicalMarks(database: Database, materializations: ResolvedCanonicalMark[]) {
  if (materializations.length === 0) return false;
  const serialNumbers = materializations.map((item) => item.mark.serialNumber);
  const before = await readCanonicalStates(database, serialNumbers);
  const markRows = materializations.map(({ contributors, mark, versions }) => {
    const claimPaths = new Set(contributors.map((contributor) => contributor.claimPath));
    return {
      authority_policy_version: versions.authorityPolicy,
      filing_date: mark.filingDate,
      filing_date_present: claimPaths.has("case-file/case-file-header/filing-date"),
      mark_drawing_code: mark.markDrawingCode,
      mark_drawing_code_present: claimPaths.has("case-file/case-file-header/mark-drawing-code"),
      normalization_version: versions.normalization,
      projection_version: versions.projection,
      registration_date: mark.registrationDate,
      registration_date_present: claimPaths.has("case-file/case-file-header/registration-date"),
      registration_number: mark.registrationNumber,
      registration_number_present: claimPaths.has("case-file/registration-number"),
      serial_number: mark.serialNumber,
      source_profile_version: versions.sourceProfile,
      source_transaction_date: mark.sourceTransactionDate,
      source_transaction_date_present: claimPaths.has("case-file/transaction-date"),
      status_code: mark.statusCode,
      status_code_present: claimPaths.has("case-file/case-file-header/status-code"),
      status_date: mark.statusDate,
      status_date_present: claimPaths.has("case-file/case-file-header/status-date"),
      word_mark: mark.wordMark,
      word_mark_present: claimPaths.has("case-file/case-file-header/mark-identification"),
    };
  });
  await database`
    with input as (
      select * from jsonb_to_recordset(${database.json(markRows)}) as row(
        serial_number text, registration_number text, registration_number_present boolean,
        word_mark text, word_mark_present boolean, mark_drawing_code text, mark_drawing_code_present boolean,
        filing_date date, filing_date_present boolean, registration_date date, registration_date_present boolean,
        status_code text, status_code_present boolean, status_date date, status_date_present boolean,
        source_transaction_date date, source_transaction_date_present boolean, normalization_version text,
        source_profile_version text, projection_version text, authority_policy_version text
      )
    ), updated as (
      update mark set
        registration_number = case when input.registration_number_present then input.registration_number else mark.registration_number end,
        word_mark = case when input.word_mark_present then input.word_mark else mark.word_mark end,
        mark_drawing_code = case when input.mark_drawing_code_present then input.mark_drawing_code else mark.mark_drawing_code end,
        filing_date = case when input.filing_date_present then input.filing_date else mark.filing_date end,
        registration_date = case when input.registration_date_present then input.registration_date else mark.registration_date end,
        status_code = case when input.status_code_present then input.status_code else mark.status_code end,
        status_date = case when input.status_date_present then input.status_date else mark.status_date end,
        source_transaction_date = case when input.source_transaction_date_present then input.source_transaction_date else mark.source_transaction_date end,
        normalization_version = input.normalization_version,
        source_profile_version = input.source_profile_version,
        projection_version = input.projection_version,
        authority_policy_version = input.authority_policy_version
      from input where mark.serial_number = input.serial_number
      returning mark.serial_number
    )
    insert into mark (
      serial_number, registration_number, word_mark, mark_drawing_code, filing_date, registration_date,
      status_code, status_date, source_transaction_date, normalization_version, source_profile_version,
      projection_version, authority_policy_version
    ) select serial_number, registration_number, word_mark, mark_drawing_code, filing_date, registration_date,
      status_code, status_date, source_transaction_date, normalization_version, source_profile_version,
      projection_version, authority_policy_version from input
    on conflict (serial_number) do nothing
  `;

  const collectionSerials = (group: string) => materializations
    .filter((item) => item.contributors.some((contributor) => contributor.group === group))
    .map((item) => item.mark.serialNumber);
  const classSerials = collectionSerials("classes");
  if (classSerials.length > 0) {
    await database`delete from mark_class where serial_number in ${database(classSerials)}`;
    const rows = materializations.flatMap((item) => item.contributors.some((c) => c.group === "classes")
      ? item.classes.map((value, index) => ({
        international_code: value.internationalCode,
        ordinal: index + 1,
        serial_number: item.mark.serialNumber,
        status_code: value.statusCode,
        status_date: value.statusDate,
      }))
      : []);
    if (rows.length > 0) await database`insert into mark_class ${database(rows)}`;
  }
  const goodsSerials = collectionSerials("goods-services");
  if (goodsSerials.length > 0) {
    await database`delete from mark_goods_services where serial_number in ${database(goodsSerials)}`;
    const rows = materializations.flatMap((item) => item.contributors.some((c) => c.group === "goods-services")
      ? item.goodsServices.map((value, index) => ({
        ordinal: index + 1,
        serial_number: item.mark.serialNumber,
        text: value.text,
        type_code: value.typeCode,
      }))
      : []);
    if (rows.length > 0) await database`insert into mark_goods_services ${database(rows)}`;
  }
  const ownerSerials = collectionSerials("owners");
  if (ownerSerials.length > 0) {
    await database`delete from mark_owner where serial_number in ${database(ownerSerials)}`;
    const rows = materializations.flatMap((item) => item.contributors.some((c) => c.group === "owners")
      ? item.owners.map((value, index) => ({
        entry_number: value.entryNumber,
        ordinal: index + 1,
        party_name: value.partyName,
        party_type: value.partyType,
        serial_number: item.mark.serialNumber,
      }))
      : []);
    if (rows.length > 0) await database`insert into mark_owner ${database(rows)}`;
  }

  const eventRows = materializations.flatMap((item) => item.statusEvents.map((event) => ({
    code: event.code,
    description: event.description,
    event_date: event.date,
    event_key: eventKey(event),
    event_number: event.number,
    serial_number: item.mark.serialNumber,
    type: event.type,
  })));
  if (eventRows.length > 0) await database`insert into mark_status_event ${database(eventRows)} on conflict do nothing`;

  const scopes = new Map<string, { claimPath: string; group: string; serialNumber: string; wholeGroup: boolean }>();
  for (const item of materializations) {
    for (const contributor of item.contributors) {
      const wholeGroup = completeCollectionGroups.has(contributor.group);
      const key = `${item.mark.serialNumber}\u0000${contributor.group}\u0000${wholeGroup ? "" : contributor.claimPath}`;
      scopes.set(key, {
        claimPath: contributor.claimPath,
        group: contributor.group,
        serialNumber: item.mark.serialNumber,
        wholeGroup,
      });
    }
  }
  if (scopes.size > 0) {
    await database`
      delete from mark_group_contributor contributor using jsonb_to_recordset(${database.json([...scopes.values()])})
        as scope("serialNumber" text, "group" text, "claimPath" text, "wholeGroup" boolean)
      where contributor.serial_number = scope."serialNumber"
        and contributor.group_name = scope."group"
        and (scope."wholeGroup" or contributor.claim_path = scope."claimPath")
    `;
  }
  const contributorRows = materializations.flatMap((item) => item.contributors.map((contributor) => ({
    artifact_version_sha256: contributor.artifactVersionSha256,
    claim_path: contributor.claimPath,
    group_name: contributor.group,
    physical_record_index: contributor.physicalRecordIndex,
    product: contributor.product,
    serial_number: item.mark.serialNumber,
  })));
  if (contributorRows.length > 0) {
    await database`insert into mark_group_contributor ${database(contributorRows)} on conflict do nothing`;
  }

  const after = await readCanonicalStates(database, serialNumbers);
  return serialNumbers.some((serialNumber) => JSON.stringify(before.get(serialNumber)) !== JSON.stringify(after.get(serialNumber)));
}

async function readCanonicalMark(database: Database, serialNumber: string): Promise<ResolvedCanonicalMark | null> {
  const [mark] = await database<MarkRow[]>`
    select serial_number as "serialNumber", registration_number as "registrationNumber",
      word_mark as "wordMark", mark_drawing_code as "markDrawingCode", filing_date::text as "filingDate",
      registration_date::text as "registrationDate", status_code as "statusCode", status_date::text as "statusDate",
      source_transaction_date::text as "sourceTransactionDate", normalization_version as normalization,
      source_profile_version as "sourceProfile", projection_version as projection,
      authority_policy_version as "authorityPolicy"
    from mark where serial_number = ${serialNumber}
  `;
  if (!mark) return null;
  const classes = await database<CanonicalClass[]>`
    select international_code as "internationalCode", status_code as "statusCode", status_date::text as "statusDate"
    from mark_class where serial_number = ${serialNumber} order by ordinal
  `;
  const goodsServices = await database<CanonicalGoodsServices[]>`
    select type_code as "typeCode", text
    from mark_goods_services where serial_number = ${serialNumber} order by ordinal
  `;
  const owners = await database<CanonicalOwner[]>`
    select entry_number as "entryNumber", party_name as "partyName", party_type as "partyType"
    from mark_owner where serial_number = ${serialNumber} order by ordinal
  `;
  const statusEvents = await database<CanonicalStatusEvent[]>`
    select code, event_date::text as date, description, event_number as number, type
    from mark_status_event where serial_number = ${serialNumber}
  `;
  const contributors = await database<Contributor[]>`
    select artifact_version_sha256 as "artifactVersionSha256", claim_path as "claimPath", group_name as "group",
      physical_record_index as "physicalRecordIndex", product
    from mark_group_contributor where serial_number = ${serialNumber}
    order by group_name, claim_path, product, artifact_version_sha256, physical_record_index
  `;
  const { authorityPolicy, normalization, projection, sourceProfile, ...canonicalMark } = mark;
  return {
    classes,
    contributors,
    goodsServices,
    kind: "resolved",
    mark: canonicalMark,
    owners,
    statusEvents: statusEvents.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    versions: { authorityPolicy, normalization, projection, sourceProfile } as ResolvedCanonicalMark["versions"],
  };
}

async function inReadSnapshot<T>(database: postgres.Sql, work: (transaction: Database) => Promise<T>) {
  return database.begin("isolation level repeatable read read only", work);
}

export function createCanonicalMarkRepository(database: postgres.Sql) {
  return {
    async read(serialNumber: string): Promise<ResolvedCanonicalMark | null> {
      return inReadSnapshot(database, (transaction) => readCanonicalMark(transaction, serialNumber));
    },

    async readByRegistrationNumber(registrationNumber: string): Promise<ResolvedCanonicalMark | null> {
      return inReadSnapshot(database, async (transaction) => {
        const [identity] = await transaction<[{ serialNumber: string }]>`
          select serial_number as "serialNumber"
          from mark where registration_number = ${registrationNumber}
        `;
        return identity ? readCanonicalMark(transaction, identity.serialNumber) : null;
      });
    },

    async replace(materialization: ResolvedCanonicalMark): Promise<void> {
      await database.begin((transaction) => replaceCanonicalMark(transaction, materialization));
    },
  };
}
