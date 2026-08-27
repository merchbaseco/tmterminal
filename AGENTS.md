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

## Venue

Cloud Agents use `.cursor/start.sh` and local Postgres on `127.0.0.1`. The
website origin must be `127.0.0.1`, not `localhost`. Seed is fabricated and
local only. See [Development](docs/operations/development.md).

Workstation `bun run dev` points at production over Tailscale. Do not seed a
non-loopback database.

Secrets resolve from 1Password through Varlock. There is no `.env` file.
See [Environment](docs/operations/environment.md).

## Verification

- Parser: byte-exact USPTO XML fixtures.
- Ingestion: restart, idempotency, cleanup, replay, and live visibility.
- Search: filter, sort, count, pagination, and index use.
- Client and CLI: generated contracts plus JSON envelopes.
- Website: focused tests plus a real browser happy path.
- Deploy: Compose health before release.

CI Quality is the fast lane (`bun run check:fast`). `bun run check` is the
full set. Read [Testing](docs/operations/testing.md) before changing that split.

## Operator

- Repair one source file only after reading
  [Source repair](docs/operations/source-repair.md).
- Linear lives on the Products team (`PRD`) with the `Trademark Terminal`
  label. Triage labels are in [Issues](docs/operations/issues.md).
- Quiet Utility and COSS rules live in [Design](docs/design/system.md).
