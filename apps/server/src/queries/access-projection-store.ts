import type {
  AccessProjection,
  AccessProjectionEvent,
  AccessProjectionStore,
  ProjectionIdentity,
} from "@merchbaseco/access";
import type postgres from "postgres";

interface StoredProjection {
  access: AccessProjection["access"] | null;
  accessValidUntil: Date | null;
  issuer: string;
  merchbaseUserId: string | null;
  sourceUpdatedAt: number;
  subject: string;
}

export function createAccessProjectionStore(
  database: postgres.Sql,
  authorityOrigin = process.env.MERCHBASE_ACCESS_AUTHORITY_ORIGIN ??
    "https://access-internal.merchbase.co"
): AccessProjectionStore {
  return {
    apply: (event) => applyProjectionEvent(database, event),
    findByIdentity: (identity) => findByIdentity(database, identity),
    findByMerchbaseUserId: (merchbaseUserId) =>
      findByMerchbaseUserId(database, merchbaseUserId, authorityOrigin),
  };
}

async function applyProjectionEvent(database: postgres.Sql, event: AccessProjectionEvent) {
  await database.begin(async (transaction) => {
    const [receipt] = await transaction<[{ eventId: string }]>`
      insert into access_projection_receipt (event_id)
      values (${event.eventId})
      on conflict do nothing
      returning event_id as "eventId"
    `;
    if (!receipt) {
      return;
    }

    if (event.type === "upsert") {
      await transaction`
        insert into access_projection (
          issuer,
          subject,
          merchbase_user_id,
          access,
          access_valid_until,
          source_updated_at
        )
        values (
          ${event.projection.issuer},
          ${event.projection.subject},
          ${event.projection.merchbaseUserId},
          ${event.projection.access},
          ${
            event.projection.accessValidUntil === null
              ? null
              : new Date(event.projection.accessValidUntil)
          },
          ${event.projection.sourceUpdatedAt}
        )
        on conflict (issuer, subject) do update set
          merchbase_user_id = excluded.merchbase_user_id,
          access = excluded.access,
          access_valid_until = excluded.access_valid_until,
          source_updated_at = excluded.source_updated_at,
          updated_at = now()
        where access_projection.source_updated_at < excluded.source_updated_at
      `;
      return;
    }

    await transaction`
      insert into access_projection (
        issuer,
        subject,
        merchbase_user_id,
        access,
        access_valid_until,
        source_updated_at
      )
      values (
        ${event.identity.issuer},
        ${event.identity.subject},
        null,
        null,
        null,
        ${event.sourceUpdatedAt}
      )
      on conflict (issuer, subject) do update set
        merchbase_user_id = null,
        access = null,
        access_valid_until = null,
        source_updated_at = excluded.source_updated_at,
        updated_at = now()
      where access_projection.source_updated_at < excluded.source_updated_at
    `;
  });
}

async function findByIdentity(database: postgres.Sql, identity: ProjectionIdentity) {
  const [projection] = await database<StoredProjection[]>`
    select
      issuer,
      subject,
      merchbase_user_id as "merchbaseUserId",
      access,
      access_valid_until as "accessValidUntil",
      source_updated_at::float8 as "sourceUpdatedAt"
    from access_projection
    where issuer = ${identity.issuer}
      and subject = ${identity.subject}
  `;
  if (!projection) {
    return { type: "missing" as const };
  }
  const active = storedProjection(projection);
  return active ? { projection: active, type: "active" as const } : { type: "tombstone" as const };
}

async function findByMerchbaseUserId(
  database: postgres.Sql,
  merchbaseUserId: string,
  authorityOrigin: string
) {
  const [projection] = await database<StoredProjection[]>`
    select
      issuer,
      subject,
      merchbase_user_id as "merchbaseUserId",
      access,
      access_valid_until as "accessValidUntil",
      source_updated_at::float8 as "sourceUpdatedAt"
    from access_projection
    where issuer = ${authorityOrigin}
      and subject = ${merchbaseUserId}
      and merchbase_user_id = ${merchbaseUserId}
      and access is not null
  `;
  return projection ? storedProjection(projection) : null;
}

function storedProjection(projection: StoredProjection): AccessProjection | null {
  if (projection.access === null || projection.merchbaseUserId === null) {
    return null;
  }
  return {
    ...projection,
    access: projection.access,
    accessValidUntil: projection.accessValidUntil?.getTime() ?? null,
    merchbaseUserId: projection.merchbaseUserId,
  };
}
