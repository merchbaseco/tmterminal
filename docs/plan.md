---
summary: Defines Trademark Turtle's product scope, service boundaries, public contracts, persistence model, deployment shape, and implementation sequence.
read_when:
  - changing product scope, architecture, package ownership, authentication, persistence, deployment, or implementation order
  - deciding whether behavior belongs in Trademark Turtle, MerchBase, a published client, the CLI, or the website
---

# Trademark Turtle implementation plan

## Summary

Trademark Turtle is the standalone owner of US trademark ingestion and search for the MerchBase product family. It runs on the Mac mini, synchronizes official USPTO data, and exposes one authenticated typed interface consumed by its website, HTTP client, CLI, and eventually MerchBase.

The service name is **Trademark Turtle**. Its technical identity is `tmturtle`. The initial host is `https://tmturtle.merchbase.co`; a standalone `.com` is intentionally deferred.

This plan was researched against:

- MerchBase app revision `9af1ad2eac1ebf91ce24de4d57b3dd91f4781469`
- BidBeacon revision `4c25f7f6092405157482cbdc0f180e1f3ca7871f`
- MerchBase Core revision `f132d884ffece9671f8b584eb427dbb2561a1ad6`
- Current USPTO Open Data Portal and trademark XML documentation reviewed on 2026-07-14

## Product contract

### Users

- Print-on-demand sellers checking listing text before publication
- Authenticated website users searching and inspecting clothing marks
- MerchBase as the anchor programmatic consumer
- Developers and power users using the typed client or CLI

### v1 jobs

- Search Class 025 word marks with explicit match modes and filters
- Resolve a trademark by exact serial number
- Resolve a trademark by exact registration number
- Match listing text against live marks
- Inspect the newest trademark activity
- Run filed, registered, and opposition reports
- Inspect trademark-data freshness and ingestion health
- Create and revoke API keys

### Non-goals

- Anonymous or public data routes
- Marketing site or public search pages
- Custom design-system or dashboard infrastructure
- Billing, plans, or teams
- Customer-configured trademark watches, alerts, or email delivery
- Browser extension
- Trademark filing or prosecution workflows
- Legal advice or automated risk scores
- Design-mark image similarity
- Non-US trademark sources
- Assignment and TTAB data

The v1 website is a deliberately thin authenticated client. Its product and visual contract lives in `docs/website.md`; it must not grow into a marketing site or general-purpose dashboard.

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
    web/                     # private Vite/React search website
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
- Vite, React, and React Router
- TanStack Query and TanStack Virtual
- Tailwind CSS 4 and stock COSS UI components
- Shared MerchBase Clerk authentication
- Docker Compose and Caddy

## Authentication

Every data procedure requires an authenticated account context. The website authenticates with the shared MerchBase Clerk profile; the HTTP client and CLI authenticate with Trademark Turtle API keys. Only process/database readiness is anonymous.

Browser contract:

- Signed-out users may compose a search, but submission starts Clerk sign-in
- Preserve and execute the composed search after authentication
- Create or resolve one local account from the stable Clerk user ID; never from email or request headers
- Never expose a long-lived Trademark Turtle API key to browser storage

Key contract:

- Token format: `ttk_<key-id>_<secret>`
- Persist a SHA-256 secret hash and short display suffix; never persist the raw token
- Compare hashes with timing-safe equality
- Return a new key exactly once
- Allow multiple active keys plus immediate, idempotent revocation
- Resolve account/context from the key before executing a procedure
- Keep revoked rows for audit and coalesce approximate last-used updates

One request selects exactly one credential. Supplying both Clerk and API-key credentials is invalid; a failed credential never falls through to another mechanism. Account key management requires Clerk. Trademark-data reads accept Clerk or API-key identity. Detailed ingestion diagnostics require a database-backed operator role.

Authenticated website users create and revoke their own keys. The host-side command remains available for bootstrap and recovery:

```bash
bun run api-keys:create --name merchbase
```

The command runs against the service database on the Mac mini. No unauthenticated bootstrap endpoint exists.

Client credentials:

- `TMTURTLE_BASE_URL`
- `TMTURTLE_API_KEY`
- CLI stores the API key in a normalized-origin-specific macOS Keychain entry
- Environment variables remain the non-interactive/CI path

## USPTO sources and freshness

Sources: USPTO Open Data Portal annual and daily full-text trademark XML without images (`TRTYRAP` and `TRTDXFAP`).

- Product discovery: `https://api.uspto.gov/api/v1/datasets/products/<product>`
- Authentication: `x-api-key`

Freshness contract:

> The public data-through date is the contiguous source date through which every required USPTO artifact is complete.

Trademark Turtle records the complete-through date, last successful update time, and query-visible data version. Rows committed after the complete frontier remain live; a gap makes sync status degraded but never hides available data.

The worker coordinates discovery and downloads globally per USPTO credential. USPTO limits one API key to 20 annual downloads of the same file and one IP to five files per 10 seconds; signed redirect URLs expire after five seconds. Trademark Turtle processes one artifact at a time on a fixed 10-second cadence, follows an accepted redirect immediately without forwarding the API key, and stops after eight consecutive persisted attempts. Retryable responses use persisted capped exponential backoff with jitter and honor provider retry headers when present. Authentication, permanent request errors, parser failures, and unresolved artifact identity changes stop without redownloading the artifact.

Authoritative references:

- <https://data.uspto.gov/bulkdata/datasets/trtyrap>
- <https://data.uspto.gov/apis/getting-started>
- <https://www.uspto.gov/learning-and-resources/xml-resources>
- <https://www.uspto.gov/subscription-center/2024/updated-trademark-datasets-now-available>

## Ingestion module

`docs/ingestion.md` is the normative source, artifact-lifecycle, live-projection, replay, and freshness contract.

The ingestion module exposes two operations—reconcile the next database-derived action and read truthful status—while hiding USPTO, ZIP, XML, and projection details. Its invariants are:

- Serial number is global mark identity; nonzero registration number is a unique secondary identity.
- The exact pinned 91-member annual set establishes the baseline. Metadata dates establish membership and the public frontier, not record transaction bounds.
- One compact artifact row owns each product/filename/SHA, coverage, state, counts, current error, and transient ZIP pointer.
- Exactly one ZIP/XML is streamed at a time. No extracted XML is written. Selected marks are projected in fixed batches.
- Raw ZIPs are deleted immediately after success or terminal failure.
- Every projected mark/class/owner/goods/status-event row carries compact source coordinates.
- Every committed artifact updates the live tables immediately. There is no hidden build or activation pointer.
- Daily records upsert newer Class 025 state or remove a mark when a later complete record no longer asserts Class 025.
- Unknown values remain raw/unknown instead of being guessed.

Stored and programmatic trademark data is Class 025 only. The parser validates and physically counts every source record, then projects records with explicit `primary-code` `025` and a non-empty `mark-identification`. A valid artifact with zero selected marks still completes successfully.

The annual baseline pins exactly the 91 officially enumerated members covering 1884-04-07 through 2025-12-31. After those complete, the same worker discovers calendar-contiguous daily files and continues forever.

## Database map

### Trademark data

- `mark`: live identity and presentation keyed by serial number
- `mark_class`: projected International Class state per mark
- `mark_owner`: current normalized owner group
- `mark_goods_services`: source-reported goods/services text and type per mark
- `mark_status_event`: distinct source-reported status transitions with provenance

Every projected row carries the annual artifact filename, SHA-256, product, and physical record index.

Required indexes:

- Unique B-tree registration-number index where registration number is non-null
- `pg_trgm` GIN index for contains search
- B-tree normalized exact word-mark index
- Partial live-mark indexes for common match paths
- Source activity, filing, registration, publication, status, and class indexes

### Ingestion

- `source_lane`
- `source_artifact`
- `data_state`
- pg-boss job execution tables

### Auth and events

- `account`
- `clerk_identity`
- `api_key`
- `role_assignment`

Account data and keys are not re-derivable and receive backup priority. Projected rows, source artifacts, and coordinates are rebuildable but expensive and quota-sensitive, so database backup covers them; raw artifacts are not backup state.

## Canonical HTTP interface

One public tRPC router defines customer capabilities. The website, HTTP client, and CLI expose authorized projections of that router; they are not required to expose every procedure. Compact ingestion state lives under a private operator router and does not enter published SDK types.

### Marks

- `marks.search`
  - Discriminated input: Multi with `exact | partial | both`, Split, or Wildcard
  - Multi exact and partial are literal normalized equality/contains semantics
  - Split searches exact matches for all adjacent Unicode word-token combinations; punctuation separates tokens
  - Wildcard uses `*` for zero or more characters across the whole normalized mark; other SQL wildcard characters remain literal
  - Filters: live/dead, mark type, registration state
  - Sorts: relevance, newest activity, oldest activity
  - Source transaction date defines activity; status date remains a separate field
  - Server-side filter, deterministic sort, count, limit, and offset; every order ends with serial number
  - Continuation requests include expected data version and fail with `CONFLICT` after query-visible data changes
  - Output: `{ items, total, limit, offset, meta: { dataThroughDate, dataVersion } }`
- `marks.get`
  - Exact serial number only
- `marks.get-by-registration`
  - Exact registration number only
- `marks.match-text`
  - Server-owned live word-mark candidate generation and Unicode-aware span detection
  - Explicit type filters within Class 025 data, all overlapping matches, stable UTF-16 offsets, and no silent truncation
- `marks.latest`
  - Recent source transaction activity with stable pagination

### Reports

- `reports.run`
  - Discriminated queryless result view generated from typed constraints
  - Filed and registered use dedicated milestone dates for previous Monday through Sunday
  - Published for opposition means the current versioned USPTO status semantic, not every historical publication and not a legal-open-window guarantee
  - Filters: live/dead, mark type, registration state within Class 025 data
  - Server-side sort, count, limit, and offset
  - Same data envelope as `marks.search`; date-window reports return resolved `from` and `to`

### Sync

- `sync.status`
  - Complete frontier, last successful update, data version, active state, pending/failed counts, and staleness

External realtime subscriptions are deferred in v1. Material artifact commits update the monotonic `data_state` version used by continuation checks and cache invalidation.

### Operator

- `ops.sync.status`
- `ops.sync.artifacts`

These private procedures require a Clerk session plus a database-backed operator role. The website exposes them only on the operator-only `/ops/sync` route; they do not enter the published client or CLI.

### Account

- `account.me`
  - Validate the selected credential and return safe account/key context
- `account.api-keys.list`
  - List key name, suffix, creation time, last-used time, and status
- `account.api-keys.create`
  - Create a named key and return its raw token exactly once
- `account.api-keys.revoke`
  - Revoke one owned key

API-key list/create/revoke require Clerk identity. Manual bootstrap and recovery remain host-side.

### Errors

Stable codes:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `BAD_REQUEST`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `SERVICE_UNAVAILABLE`
- `INTERNAL_ERROR`

## HTTP client

Package: `@tmturtle/http-client`.

Exports:

- `createTmturtleClient({ baseUrl, apiKey, headers?, batch? })`
- `TmturtleClient`
- `TmturtleRouterInputs`
- `TmturtleRouterOutputs`

Use nested proxy access:

```ts
const result = await client.marks.search.query({
  query: 'good vibes',
  mode: 'split',
  status: 'live',
  limit: 25,
  offset: 0,
});
```

Generate and bundle types from the server router. Never duplicate endpoint DTOs. The HTTP client and CLI use lockstep SemVer and are published locally using the same release contract as MerchBase Core.

## CLI

Package: `@tmturtle/cli`. Executable: `tt`.

`docs/cli.md` is the normative command, credential, JSON output, error, and pagination contract. The CLI exposes API-key-authorized automation procedures only. Clerk-only key management and private operator procedures remain outside it.

## MerchBase integration

Trademark Turtle is a sibling service with a stable typed interface. It owns USPTO data and returns typed authentication, validation, and data-version errors. MerchBase owns its adapter, local preferences, upload policy, fallback behavior, migration, and cutover acceptance. Those concerns live in a separate MerchBase integration plan and do not shape Trademark Turtle's service internals.

## Deployment

Mac mini Docker Compose topology:

- PostgreSQL 16 with a dedicated named volume
- One-shot migration command that completes before API and worker start
- One-shot database migration before API and worker startup
- `tmturtle-core`: Fastify/tRPC API and anonymous readiness endpoint; no jobs or schedules
- `tmturtle-worker`: same image, pg-boss reconciliation/scheduling entrypoint
- Caddy: serves the built website at `tmturtle.merchbase.co` and proxies `/api`
- Artifact working volume for one streamed USPTO ZIP

All host ports bind to loopback behind the existing reverse-proxy/Tailscale setup.

The workspace is runnable before product procedures land:

```bash
bun install --frozen-lockfile
bun run check
bun run test:integration:compose
bun run compose:up
bun run compose:smoke
```

Compose waits for PostgreSQL, applies Drizzle migrations once, and starts the API and worker after migration succeeds. The anonymous `/api/health` endpoint reports process/database readiness with no trademark-data fields. Caddy serves the website shell and proxies `/api`; the API process never owns worker schedules. See [Local runtime operations](operations/local-runtime.md) for local startup and [Mac mini deployment](operations/deployment.md) for production verification and rollback.

Deployment follows the house pattern:

1. Self-hosted GitHub Actions runner on push to `main`
2. `git pull --ff-only` in `/Users/zknicker/srv/tmturtle`
3. Configure stable `TMTURTLE_WEB_PORT` and `TMTURTLE_API_PORT` values in the deployment environment
4. `docker compose build`
5. `docker compose up -d`
6. Verify migration, API/database readiness, worker registration, and sync state

Operations:

- `/api/health` for process and database readiness only
- Nightly PostgreSQL backup covering accounts, live trademark data, artifacts, and data state
- Compact artifact checksum/source-coordinate inventory with terminal raw-object deletion
- Disk-pressure alert for database and artifact volumes
- Complete-frontier staleness and artifact-gap alerts
- Provider-access, artifact failure, stale-frontier, disk, and backup-age alerts
- Runbooks for key rotation, restore, and exact-SHA deployment

## Testing

- Byte-exact real USPTO fixtures with source manifests and action-key context
- Full annual Class 025 record plus the authentic maximum unselected annual record
- Fixed projection batches, malformed-record failure, restart, idempotency, and immediate ZIP cleanup tests
- Exact annual/daily discovery, partial-data visibility, atomic artifact replay, source-coordinate, and data-version tests
- PostgreSQL integration tests for search/filter/sort/count/pagination
- Unicode normalization, wildcard escaping, Split punctuation, overlap, and span-offset tests
- Query-plan checks for exact B-tree and trigram index use
- Auth hash, timing path, cross-account ownership, multiple-key, coalesced last-used, and revocation tests
- Clerk-session and API-key authentication parity tests
- Generated client contract/build tests
- CLI credential precedence/origin binding, JSON stdout/stderr, exit, and pagination-conflict tests
- Website route, URL-state, infinite-scroll, theme, and API-key flow tests
- Browser verification for signed-out search gating, authenticated search/detail, and the riskiest adjacent failure path
- Live source-shape smoke test without relying on it for deterministic CI
- Compose migration, readiness, worker, backup, and restore smoke tests

## Delivery phases

### Phase 0: repository and runtime spine

- Workspace/package structure
- Server, worker, one-shot migrations, PostgreSQL, and Compose
- Website shell, Clerk authentication, and API-key management
- API-key schema and host-side recovery command
- Health endpoint and local verification

Acceptance: Compose starts cleanly; a Clerk-authenticated website user creates a key, and that key authenticates `account.me`.

### Phase 1: source projection proof

- Pin current USPTO application/status contracts and source manifests
- Retain byte-exact annual record fixtures
- Parse a full Class 025 application record into the direct projection
- Implement exact `marks.get`
- Generate the HTTP client
- Implement `tt auth set` and `tt marks get`
- Prove the same known serial through the server, client, CLI, and website test seams
- Keep repository fixtures outside the runtime image

Acceptance:

> The exact retained record projects consistently through every test seam without becoming startup data.

### Phase 2: durable live-data ingestion

- Compact source-artifact and data-version state
- Provider-aware downloads, checksums, transient raw artifacts, and immediate terminal cleanup
- `unzipper` plus `xml-flow` streaming direct projection in fixed batches
- Exact 91-member annual baseline followed by daily continuation
- Artifact-scoped replay, live visibility, freshness frontier, one provider lane, observability, backup, and recovery

Acceptance: every successful artifact is immediately queryable; replay is atomic and idempotent; restarts resume one retained ZIP without another provider download.

### Phase 3: search and text matching

- Discriminated Multi, Split, and Wildcard modes
- Status/type/registration filters within Class 025 data
- Server-side sort/count/offset pagination with data-version conflict protection
- Website search, generic reports, inline infinite scroll, and mark detail
- Trigram and exact indexes
- `marks.match-text` and `marks.latest`
- Query-plan, Unicode, span, report-date, and opposition-status tests

Acceptance: search and matching satisfy the public contract at production-scale query plans.

### Phase 4: package release and operations

- Publish exact-pinned HTTP client and CLI versions
- Deploy the annual-baseline and daily-continuation runtime
- Verify backup/restore and exact-SHA deployment
- Exercise provider-access and terminal artifact failures

Acceptance: the deployed service re-downloads one official artifact at a time, preserves account state, reports truthful freshness, and serves the published client/CLI contracts.

## Decisions fixed by this plan

- Thin authenticated website included in v1
- Shared MerchBase Clerk session for browser access; API keys for client and CLI access
- Website self-service API keys with host-side bootstrap and recovery
- Stored, website, API, HTTP-client, and CLI data fixed to International Class 025 in v1
- Live, dead, and unknown mark states within that data
- Direct perpetual live projection; no source-observation, claim, contributor, publication-candidate, generation, or reprocessing graph
- Annual baseline membership is distinct from record transaction coverage
- Exact 91-member baseline through 2025-12-31 followed by daily continuation
- Public complete frontier distinct from rows already available in the live tables
- Private operator diagnostics and database-backed operator roles
- No external realtime subscription in v1
- Dedicated single worker/scheduler in v1
- Private server and website apps; published client and CLI only
- `tt` executable
- `tmturtle.merchbase.co` initial host
- COSS UI, Archivo Variable, light/dark/system appearance, and one chartreuse primary
- Marketing site, standalone `.com`, billing, and alerts remain future product decisions
