# Trademark Terminal

Use Bun and Conventional Commits. Prefer the right end state. Do not add
legacy aliases, dual-write paths, or website features outside the thin v1
surface.

Read [`GLOSSARY.md`](GLOSSARY.md) for product nouns. `CONTEXT.md` is a symlink
to that file for Matt Pocock skills.

## Invariants

- Exact serial (8 digits) and registration (7 digits) numbers are identities.
  Never treat them as search terms.
- Filter and sort on the server before pagination and count.
- USPTO artifacts update live trademark tables in bounded transactions.
  Ingestion never gates reads.
- Data procedures need a Clerk session or an API key. Anonymous routes are
  readiness (`/api/health`) and aggregate `/api/status` only.
- Annual and daily are USPTO packaging, not query-visible datasets.

## Development

One model everywhere. `bun run dev` and Cloud `.cursor/start.sh` both use
local Postgres on `127.0.0.1`, apply migrations, and seed fabricated data.
The seed refuses any non-loopback host and never calls USPTO. Worker stays
off. Website origin is `127.0.0.1`, not `localhost`. Docs at `/docs` on the
website port; VitePress also serves them on `127.0.0.1:5174` during `dev`.

## Secrets

The committed `.env.schema` is the contract. Varlock resolves values from
1Password. There is no `.env` file. `VARLOCK_ENV` is `production`,
`development`, or `test`. GitHub Actions stores one secret,
`GH_DEPLOY_AGENT_PRODUCTION_OP_TOKEN`, so CI and deploy can read 1Password.
Everything else comes from the schema.

## Release

Use the `release-trademark-terminal` skill. It bumps `VERSION`, updates
`CHANGELOG.md`, and opens a PR. Merging a release PR deploys through GitHub
Actions. Ordinary merges to `main` do not. Do not deploy from a laptop.

## Verification

- Parser: byte-exact USPTO XML fixtures.
- Ingestion: restart, idempotency, cleanup, replay, and live visibility.
- Search: filter, sort, count, pagination, and index use.
- Client and CLI: generated contracts plus JSON envelopes.
- Website: focused tests plus the `verify-trademark-terminal` happy and adjacent paths.
- Deploy: Compose health before release.

CI Quality is the fast lane (`bun run check:fast`). `bun run check` is the
full set. Read [Testing](docs/operations/testing.md) before changing that split.

## Operator

- Linear lives on the Products team (`PRD`) with the `Trademark Terminal`
  label. Triage labels are in [Issues](docs/operations/issues.md).
- Quiet Utility and COSS rules live in [Design](docs/design/system.md).
- Production topology and rollback notes live in
  [Deployment](docs/operations/deployment.md).
- Public docs live in `apps/docs` and ship at `/docs`. Write them with the
  fleet `write-product-docs` skill.
