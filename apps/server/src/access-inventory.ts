import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const database = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const inventory = await database.begin("read only", async (transaction) => {
    const [schema] = await transaction<
      Array<{
        accountMapping: boolean;
        accessProjection: boolean;
        accessProjectionReceipt: boolean;
      }>
    >`
      select
        exists (
          select from information_schema.columns
          where table_schema = 'public'
            and table_name = 'account'
            and column_name = 'merchbase_user_id'
        ) as "accountMapping",
        to_regclass('public.access_projection') is not null as "accessProjection",
        to_regclass('public.access_projection_receipt') is not null
          as "accessProjectionReceipt"
    `;
    const [legacy] = await transaction<
      Array<{
        accounts: number;
        activeLegacyKeys: number;
        legacyIdentities: number;
        legacyKeys: number;
      }>
    >`
      select
        (select count(*)::int from account) as accounts,
        (select count(*)::int from clerk_identity) as "legacyIdentities",
        (select count(*)::int from api_key) as "legacyKeys",
        (select count(*)::int from api_key where revoked_at is null) as "activeLegacyKeys"
    `;
    const [mapping] = schema?.accountMapping
      ? await transaction<Array<{ mappedAccounts: number }>>`
          select count(*)::int as "mappedAccounts"
          from account
          where merchbase_user_id is not null
        `
      : [{ mappedAccounts: 0 }];
    const [projections] = schema?.accessProjection
      ? await transaction<Array<{ activeProjections: number; tombstones: number }>>`
          select
            count(*) filter (
              where merchbase_user_id is not null and access is not null
            )::int as "activeProjections",
            count(*) filter (
              where merchbase_user_id is null and access is null
            )::int as tombstones
          from access_projection
        `
      : [{ activeProjections: 0, tombstones: 0 }];
    const [receipts] = schema?.accessProjectionReceipt
      ? await transaction<Array<{ projectionReceipts: number }>>`
          select count(*)::int as "projectionReceipts"
          from access_projection_receipt
        `
      : [{ projectionReceipts: 0 }];

    return {
      ...legacy,
      ...mapping,
      ...projections,
      ...receipts,
    };
  });

  process.stdout.write(`${JSON.stringify(inventory)}\n`);
} finally {
  await database.end({ timeout: 1 });
}
