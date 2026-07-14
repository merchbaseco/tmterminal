# Trademark Turtle implementation plan

## Summary

Trademark Turtle is the standalone owner of US trademark ingestion and search for the MerchBase product family. It runs on the Mac mini, synchronizes official USPTO data, and exposes one authenticated typed interface consumed by its HTTP client, CLI, and eventually MerchBase.

The service name is **Trademark Turtle**. Its technical identity is `tmturtle`. The initial host is `https://tmturtle.merchbase.co`; a standalone `.com` is intentionally deferred.

This plan was researched against:

- MerchBase app revision `9af1ad2eac1ebf91ce24de4d57b3dd91f4781469`
- BidBeacon revision `4c25f7f6092405157482cbdc0f180e1f3ca7871f`
- MerchBase Core revision `9f2534268dcfeede9b65ebafde78edac8749349a`
- Current USPTO Open Data Portal documentation reviewed on 2026-07-13

## Product contract

### Users

- Print-on-demand sellers checking listing text before publication
- MerchBase as the anchor programmatic consumer
- Developers and power users using the typed client or CLI

### v1 jobs

- Search word marks with explicit match modes and filters
- Resolve a trademark by exact serial number
- Resolve a trademark by exact registration number
- Match listing text against live marks
- Inspect the newest trademark activity
- Inspect corpus freshness and ingestion health

### Non-goals

- Website or graphical dashboard
- Clerk authentication
- Anonymous or public data routes
- Billing, plans, or teams
- Watches, alerts, or email delivery
- Browser extension
- Trademark filing or prosecution workflows
- Legal advice or automated risk scores
- Design-mark image similarity
- Non-US trademark sources
- Assignment and TTAB data

The website remains a possible future client. v1 must not scaffold infrastructure for it.

## Repository topology

```text
tmturtle/
  apps/
    server/                  # private @tmturtle/core-server
      src/
        api/
        db/
        events/
        ingestion/
        jobs/
        queries/
        services/
        worker.ts
  packages/
    http-client/             # published @tmturtle/http-client
    cli/                     # published @tmturtle/cli, bin: tt
  docs/
  compose.yml
  Dockerfile
```

The server is a private application, not a published `@tmturtle/core` package. The API server and ingestion worker use the same built image with separate entrypoints.

Target stack, following current MerchBase Core and BidBeacon conventions:

- Bun workspaces and TypeScript
- Fastify and tRPC
- Zod schemas
- Drizzle ORM and PostgreSQL
- pg-boss for scheduled and background work
- PostgreSQL-backed cross-process events
- Docker Compose and Caddy

## Authentication

Every HTTP procedure requires a Trademark Turtle API key.

Key contract:

- Token format: `ttk_<key-id>_<secret>`
- Persist a SHA-256 secret hash and short display suffix; never persist the raw token
- Compare hashes with timing-safe equality
- Print a new key exactly once
- Allow revocation and replacement
- Resolve account/context from the key before executing a procedure

Initial provisioning is host-admin-only:

```bash
bun run api-keys:create --name merchbase
```

The command runs against the service database on the Mac mini. It avoids creating an unauthenticated bootstrap endpoint.

Client credentials:

- `TMTURTLE_BASE_URL`
- `TMTURTLE_API_KEY`
- CLI stores the API key in macOS Keychain when available
- Environment variables remain the non-interactive/CI path

## USPTO sources and freshness

Primary source: USPTO Open Data Portal bulk trademark products.

- `TRTDXFAP`: daily full-text trademark activity XML without images
- `TRTYRAP`: annual full-text trademark XML without images
- Product discovery: `https://api.uspto.gov/api/v1/datasets/products/<product>`
- Authentication: `x-api-key`

Daily artifacts include filings, publications, registrations, renewals, cancellations, and amendments. Trademark Turtle is therefore a daily batch system, not a realtime USPTO stream.

Freshness contract:

> The corpus is current through the latest successfully merged USPTO daily artifact, normally within one or two US business days of USPTO publication.

Operational constraints must be represented explicitly:

- General API requests are rate-limited per key
- ZIP/PDF downloads are limited separately
- A weekly download quota can produce extended HTTP 429 lockout
- Historical backfill must be quota-aware, resumable, and allowed to run for days or weeks
- Do not evade limits with multiple keys

Authoritative references:

- <https://data.uspto.gov/bulkdata/datasets/TRTDXFAP>
- <https://data.uspto.gov/bulkdata/datasets/trtyrap>
- <https://data.uspto.gov/apis/getting-started>
- <https://data.uspto.gov/apis/api-rate-limits>

## Ingestion module

The ingestion module hides all USPTO-specific behavior behind a small service interface.

### Artifact lifecycle

```text
discovered -> downloaded -> parsed -> merged
                     \-> failed
                     \-> quarantined
```

Each artifact records product, USPTO identity, URL, publication date, checksum, byte size, state, attempts, timestamps, and last error.

### Processing

1. Discover annual and daily artifacts from the product API.
2. Persist discovery before downloading.
3. Pace downloads through a global quota-aware scheduler.
4. Retain raw ZIP artifacts on a dedicated volume.
5. Stream XML `case-file` records; do not load an artifact into memory.
6. Normalize all International Classes and both live/dead marks.
7. Write an artifact-specific staging set.
8. Merge serially into canonical tables.
9. Advance the corpus checkpoint only after the merge commits.
10. Emit cross-process sync and corpus events.

### Correctness properties

- Serial number is the canonical mark identity.
- Registration number is a unique secondary exact identity when present.
- A newer `status_date` wins; an older artifact cannot regress current state.
- Replaying an artifact converges to the same database state.
- Status changes append provenance-bearing history.
- A dead/cancelled mark is a state transition, not a row deletion.
- Parser rejects are retained with a reason and source artifact.

### Bootstrap order

1. Prove one recent daily artifact end to end.
2. Establish a useful current/live corpus.
3. Start scheduled daily ingestion.
4. Backfill historical annual artifacts under the quota budget.

The intended end state is the complete all-class, live-and-dead corpus. Class and status are query filters, never ingest filters.

## Database map

### Corpus

- `mark`: canonical current record keyed by serial number
- `mark_class`: all International Classes per mark
- `mark_owner`: normalized owner records
- `mark_goods_services`: goods/services text and class linkage
- `mark_status_event`: append-only status history with provenance

Required indexes:

- B-tree exact word-mark lookup
- Unique partial registration-number lookup
- `pg_trgm` GIN index for contains search
- Partial live-mark indexes for common match paths
- Status date, filing date, and class indexes

### Ingestion

- `dataset_product`
- `dataset_artifact`
- `ingest_checkpoint`
- `sync_state`
- `parse_reject`
- pg-boss job execution/log tables

### Auth and events

- `account`
- `api_key`
- `event_log`

Account data and keys are not re-derivable and receive backup priority. The corpus is re-derivable from retained/official artifacts.

## Canonical HTTP interface

One tRPC router defines the server, generated client types, and CLI capabilities.

### Marks

- `marks.search`
  - Query modes: `multi`, `split`, `wildcard`
  - Filters: live/dead, International Class, mark type, registration state
  - Server-side sort, count, limit, and offset
  - Output: `{ items, total, limit, offset, meta: { corpusThroughDate } }`
- `marks.get`
  - Exact serial number only
- `marks.get-by-registration`
  - Exact registration number only
- `marks.match-text`
  - Finds live word-mark matches and their text spans
- `marks.latest`
  - Recent filing/status activity with stable pagination

### Sync

- `sync.status`
  - Corpus-through date, last successful merge, active state, pending/failed counts, staleness
- `sync.artifacts`
  - Filterable operator view of artifact states and failures
- `sync.watch`
  - Typed cross-process progress/update subscription

### Admin

No remote admin surface is required for the first tracer bullet. Key provisioning and manual recovery are host-side commands. Add authenticated admin procedures only when a real remote operator requires them.

### Errors

Stable codes:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `BAD_REQUEST`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `INTERNAL_ERROR`

## HTTP client

Package: `@tmturtle/http-client`.

Exports:

- `createTmturtleClient({ baseUrl, apiKey, headers?, batch? })`
- `createTmturtleRealtimeClient({ baseUrl, apiKey })`
- `TmturtleClient`
- `TmturtleRealtimeClient`
- `TmturtleRouterInputs`
- `TmturtleRouterOutputs`

Use nested proxy access:

```ts
const result = await client.marks.search.query({
  query: 'good vibes',
  mode: 'split',
  status: 'live',
  class: '025',
  limit: 25,
  offset: 0,
});
```

Generate and bundle types from the server router. Never duplicate endpoint DTOs. The HTTP client and CLI use lockstep SemVer and are published locally using the same release contract as MerchBase Core.

## CLI

Package: `@tmturtle/cli`. Executable: `tt`.

Principles:

- Resource-first, verb-second commands
- JSON-only output
- No prompts during normal commands
- API and CLI remain one capability surface
- Credentials never appear in normal output

Envelope:

```json
{"ok":true,"data":{}}
```

```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}
```

Initial commands:

```text
tt auth set [--stdin]
tt auth status
tt auth clear

tt marks search <query> [--mode multi|split|wildcard] [--status live|dead] [--class 025] [--limit 25] [--offset 0]
tt marks get <serial-number>
tt marks get --registration <registration-number>
tt marks match --text <text>
tt marks latest [--limit 25] [--offset 0]

tt sync status
tt sync artifacts [--state failed]
```

## MerchBase integration

Trademark Turtle is a sibling of MerchBase Core, not part of it.

Cutover contract:

1. Add and pin `@tmturtle/http-client` in MerchBase.
2. Add a thin anti-corruption adapter at the existing trademark router seam.
3. Replace search/detail calls with `marks.*` procedures.
4. Replace listing-warning computation with `marks.match-text`.
5. Bridge Trademark Turtle events into existing local invalidation events.
6. Re-ingest corpus from USPTO; do not copy MerchBase's class-025 filtered corpus.
7. If ignore state is retained later, migrate and reconcile it explicitly.
8. Delete embedded trademark tables, jobs, parser, status map, USPTO key, and local sync UI after parity and reconciliation pass.

Offline behavior is degraded, not silently stale: show service-unavailable state and preserve only explicitly designed local caches.

## Deployment

Mac mini Docker Compose topology:

- PostgreSQL 16 with a dedicated named volume
- `tmturtle-core`: Fastify/tRPC API, migrations on boot, health endpoint
- `tmturtle-worker`: same image, worker entrypoint, no duplicate scheduler
- Caddy: serves `tmturtle.merchbase.co` and proxies `/api`
- Artifact volume for raw USPTO ZIP files

All host ports bind to loopback behind the existing reverse-proxy/Tailscale setup.

Deployment follows the house pattern:

1. Self-hosted GitHub Actions runner on push to `main`
2. `git pull --ff-only` in `/Users/zknicker/srv/tmturtle`
3. `docker compose build`
4. `docker compose up -d`
5. Verify health, database readiness, and sync freshness

Operations:

- `/api/health` for process and database readiness
- Nightly PostgreSQL backup, prioritizing keys/account state
- Disk-pressure alert for database and artifact volumes
- Staleness alert after two missed business-day artifacts
- Parse-reject spike alert for source-schema drift
- Runbooks for replay, quarantine, key rotation, restore, and full corpus rebuild

## Testing

- Parser fixtures from small real USPTO XML records
- Artifact replay/idempotency tests
- Status regression and amendment tests
- PostgreSQL integration tests for search/filter/sort/count/pagination
- Query-plan checks for B-tree and trigram index use
- Auth hash, revocation, and scope tests
- Generated client contract/build tests
- CLI JSON-envelope and secure-store tests
- Live source-shape smoke test without relying on it for deterministic CI
- Compose health smoke test
- MerchBase adapter and cutover parity tests

## Delivery phases

### Phase 0: repository and runtime spine

- Workspace/package structure
- Server, worker, PostgreSQL, migrations, and Compose
- API-key schema and host-side key creation
- Health endpoint and local verification

Acceptance: Compose starts cleanly; a newly generated key authenticates a typed health/context query.

### Phase 1: tracer bullet

- Discover and ingest one real recent `TRTDXFAP` artifact
- Persist artifact/checkpoint/mark data
- Implement exact `marks.get`
- Generate the HTTP client
- Implement `tt auth set` and `tt marks get`
- Deploy to the Mac mini

Acceptance:

> `tt marks get <known-serial>` returns the expected real USPTO mark through the deployed authenticated service.

### Phase 2: durable daily ingestion

- Full artifact state machine
- Quota-aware downloads and retained raw artifacts
- Streaming parser and staging merge
- Scheduled daily discovery/ingestion
- Freshness/status, retry, quarantine, observability, backup, and recovery
- Current/live corpus bootstrap followed by historical backfill

Acceptance: corpus-through date is accurate; an artifact replay is a no-op; an amendment advances state without regression.

### Phase 3: search and text matching

- Multi, split, and wildcard modes
- Class/status/type filters
- Server-side sort/count/offset pagination
- Trigram and exact indexes
- `marks.match-text` and `marks.latest`
- Query-plan and parity tests

Acceptance: search and matching satisfy the canonical contract at production-scale query plans.

### Phase 4: package release and MerchBase cutover

- Publish exact-pinned HTTP client and CLI versions
- Add realtime event watch where required
- Integrate MerchBase via its adapter seam
- Verify feature parity and service-unavailable behavior
- Remove embedded ownership after reconciliation

Acceptance: MerchBase trademark consumers use Trademark Turtle exclusively; old ingestion/query ownership is deleted.

## Decisions fixed by this plan

- Headless v1; no website or Clerk
- API key required for all HTTP access
- Host-side initial key provisioning
- Full all-class, live-and-dead end state
- Daily batch freshness, not realtime USPTO sync
- Private server app; published client and CLI only
- `tt` executable
- `tmturtle.merchbase.co` initial host
- Website/domain/alerts remain future product decisions
