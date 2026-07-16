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
- Inspect corpus freshness and ingestion health
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

One request selects exactly one credential. Supplying both Clerk and API-key credentials is invalid; a failed credential never falls through to another mechanism. Account key management requires Clerk. Safe corpus reads accept Clerk or API-key identity. Detailed ingestion diagnostics require a database-backed operator role.

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

Primary source: USPTO Open Data Portal bulk trademark products.

- `TRTDXFAP`: daily full-text trademark activity XML without images
- `TRTYRAP`: annual full-text trademark XML without images
- Product discovery: `https://api.uspto.gov/api/v1/datasets/products/<product>`
- Authentication: `x-api-key`

Daily artifacts include filings, publications, registrations, renewals, cancellations, and amendments. Trademark Turtle is therefore a daily batch system, not a realtime USPTO stream.

Freshness contract:

> The public corpus-through date is the contiguous authoritative date through which every required USPTO artifact is successfully published.

Trademark Turtle separately records the newest published source date, complete-through date, last successful merge time, and query-visible corpus version. A gap or changed upstream artifact can leave published data ahead of the complete frontier; callers see the degraded state rather than a false current date.

The worker coordinates discovery and downloads globally per USPTO credential. Provider concurrency and backoff remain runtime-configurable because ODP does not publish a stable numeric quota contract. Retryable responses use persisted exponential backoff with jitter and honor provider retry headers when present. Authentication, permanent request errors, and unresolved artifact identity changes stop the affected lane for operator action.

Authoritative references:

- <https://data.uspto.gov/bulkdata/datasets/TRTDXFAP>
- <https://data.uspto.gov/bulkdata/datasets/trtyrap>
- <https://data.uspto.gov/apis/getting-started>
- <https://www.uspto.gov/learning-and-resources/xml-resources>
- <https://www.uspto.gov/subscription-center/2024/updated-trademark-datasets-now-available>

## Ingestion module

`docs/ingestion.md` is the normative source-authority, replay, parser, publication, and freshness contract.

The ingestion module exposes a small service interface while hiding USPTO products, action keys, partial record shapes, artifact versions, and projection policies. Its invariants are:

- Serial number is canonical mark identity; nonzero registration number is a unique secondary identity.
- Logical artifacts and immutable content versions are distinct.
- Raw ZIPs are retained as byte replay authority. Lossless source observations are persisted only for records selected into the Class 025 corpus.
- USPTO records are partially ordered observations. Canonical state comes from presence-aware, group-specific claim folding, never generic row replacement.
- `status_date` orders only status facts where the source profile requires it; it never establishes whole-record authority.
- Annual metadata dates establish generation membership, not transaction coverage or cross-product precedence.
- Source authority contains only order edges proved at their documented scope. Official contracts may establish reusable profile rules; exact fixture sequences establish only their observed transitions unless further evidence proves generalization.
- Metadata dates, release times, filenames, response position, and physical order remain provenance. Unordered annual and daily claims reconcile only when every admissible fold produces the same semantic value. Identical values retain every non-dominated contributing claim; different values produce a publication-ineligible authority conflict.
- Source absence never deletes a mark or group.
- Parsing, validation, canonical publication, corpus state, and durable event insertion commit atomically.
- A dead or cancelled mark is a state transition, not a row deletion.
- Unknown values remain raw/unknown instead of being guessed.

The stored and programmatic corpus is Class 025 only. Parser identity `uspto-application-xml-v3` validates, hashes, and physically counts every source record before persisting a full observation only when the record has an explicit `primary-code` of `025` and a non-empty `mark-identification`. A valid artifact with zero selected observations remains a parsed annual-policy member. Raw retained ZIPs preserve every unselected record for later replay.

The first-publication bootstrap pins exactly the 91 officially enumerated members of the generation from 1884-04-07 through 2025-12-31 and publishes them as an unordered set. Its `completeThroughDate` and `publishedThroughDate` are both 2025-12-31. Daily artifacts remain retained, parsed, quarantined, and operator-visible, but they are outside this first publication policy. This reversible bootstrap does not declare daily data superseded or establish annual-versus-daily precedence. Mixed publication and any later annual generation require an explicit policy revision.

## Database map

### Corpus

- `mark`: canonical current identity and presentation keyed by serial number
- `mark_class`: projected International Class state per mark
- `mark_owner`: current normalized owner group
- `mark_goods_services`: source-reported goods/services text and type per mark
- `mark_status_event`: distinct source-reported status transitions with provenance

Every canonical domain group retains its contributing source observations. Canonical rows are rebuildable from immutable observations.

Required indexes:

- Unique B-tree registration-number index where registration number is non-null
- `pg_trgm` GIN index for contains search
- B-tree normalized exact word-mark index
- Partial live-mark indexes for common match paths
- Source activity, filing, registration, publication, status, and class indexes

### Ingestion

- `dataset_product`
- `artifact`
- `artifact_version`
- `artifact_discovery`
- `source_lane`
- `source_attempt`
- `source_alert`
- `parse_run`
- `source_record`
- `source_claim`
- `parse_reject`
- `publication`
- `corpus_state`
- pg-boss job execution/log tables

### Auth and events

- `account`
- `clerk_identity`
- `api_key`
- `role_assignment`
- `corpus_event`

Account data and keys are not re-derivable and receive backup priority. Source observations and provenance are rebuildable but expensive and quota-sensitive; database backup and raw-artifact retention cover both.

## Canonical HTTP interface

One public tRPC router defines customer capabilities. The website, HTTP client, and CLI expose authorized projections of that router; they are not required to expose every procedure. Detailed ingestion and reject diagnostics live under a private operator router and do not enter published SDK types.

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
  - Continuation requests include expected corpus version and fail with `CONFLICT` after query-visible corpus change
  - Output: `{ items, total, limit, offset, meta: { corpusThroughDate, corpusVersion } }`
- `marks.get`
  - Exact serial number only
- `marks.get-by-registration`
  - Exact registration number only
- `marks.match-text`
  - Server-owned live word-mark candidate generation and Unicode-aware span detection
  - Explicit type filters within the Class 025 corpus, all overlapping matches, stable UTF-16 offsets, and no silent truncation
- `marks.latest`
  - Recent source transaction activity with stable pagination

### Reports

- `reports.run`
  - Discriminated queryless result view generated from typed constraints
  - Filed and registered use dedicated milestone dates for previous Monday through Sunday
  - Published for opposition means the current versioned USPTO status semantic, not every historical publication and not a legal-open-window guarantee
  - Filters: live/dead, mark type, registration state within the Class 025 corpus
  - Server-side sort, count, limit, and offset
  - Same corpus envelope as `marks.search`; date-window reports return resolved `from` and `to`

### Sync

- `sync.status`
  - Published/complete frontier, last successful merge, corpus version, active state, pending/failed/reject counts, and staleness

External realtime subscriptions are deferred in v1. Cross-process worker completion remains database-backed through durable corpus events plus PostgreSQL notification.

### Operator

- `ops.sync.status`
- `ops.sync.artifacts`
- `ops.sync.artifact-versions`
- `ops.sync.rejects`
- `ops.sync.publications`

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

Trademark Turtle is a sibling service with a stable typed interface. It owns USPTO data and returns typed authentication, availability, and corpus-state errors. MerchBase owns its adapter, local preferences, upload policy, fallback behavior, migration, and cutover acceptance. Those concerns live in a separate MerchBase integration plan and do not shape Trademark Turtle's service internals.

## Deployment

Mac mini Docker Compose topology:

- PostgreSQL 16 with a dedicated named volume
- One-shot migration command that completes before API and worker start
- One-shot database migration before API and worker startup
- `tmturtle-core`: Fastify/tRPC API and anonymous readiness endpoint; no jobs or schedules
- `tmturtle-worker`: same image, pg-boss reconciliation/scheduling entrypoint
- Caddy: serves the built website at `tmturtle.merchbase.co` and proxies `/api`
- Artifact volume for raw USPTO ZIP files

All host ports bind to loopback behind the existing reverse-proxy/Tailscale setup.

The workspace is runnable before product procedures land:

```bash
bun install --frozen-lockfile
bun run check
bun run test:integration:compose
bun run compose:up
bun run compose:smoke
```

Compose waits for PostgreSQL, applies Drizzle migrations once, and starts the API and worker after migration succeeds. The anonymous `/api/health` endpoint reports process/database readiness with no corpus fields. Caddy serves the website shell and proxies `/api`; the API process never owns worker schedules. See [Local runtime operations](operations/local-runtime.md) for local startup and [Mac mini deployment](operations/deployment.md) for production verification and rollback.

Deployment follows the house pattern:

1. Self-hosted GitHub Actions runner on push to `main`
2. `git pull --ff-only` in `/Users/zknicker/srv/tmturtle`
3. Configure stable `TMTURTLE_WEB_PORT` and `TMTURTLE_API_PORT` values in the deployment environment
4. `docker compose build`
5. `docker compose up -d`
6. Verify migration, API/database readiness, worker registration, and corpus state

Operations:

- `/api/health` for process and database readiness only
- Nightly PostgreSQL backup covering account, observation, provenance, and corpus state
- Raw-artifact checksum inventory with no automatic v1 deletion
- Disk-pressure alert for database and artifact volumes
- Complete-frontier staleness and publication-gap alerts
- Changed-hash reissue, provider-access, reject/profile drift, and backup-age alerts
- Runbooks for reissue, replay/parser upgrade, quarantine, key rotation, restore, frontier recovery, and full corpus rebuild

## Testing

- Byte-exact real USPTO fixtures with source manifests and action-key context
- Full annual record plus status-only annual `TX` reduction tests
- Missing-versus-empty, collection replacement, status revival, class cancellation, registration, publication, and goods-markup tests
- Artifact version/reissue, out-of-order replay, idempotency, provenance, and publication-failure tests
- Worker duplicate-delivery, lease-expiry, restart, and publication-lock tests
- Published/complete frontier and corpus-version tests
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

### Phase 1: source-observation proof

- Pin current USPTO application/status contracts and source manifests
- Retain one real immutable artifact version
- Parse a full application record and status-only `TX` fixture into lossless observations
- Fold both through a versioned source profile with group provenance
- Implement exact `marks.get`
- Generate the HTTP client
- Implement `tt auth set` and `tt marks get`
- Prove the same known serial through the server, client, CLI, and website test seams
- Keep repository fixtures outside the runtime image

Acceptance:

> The exact retained record resolves consistently through every test seam without becoming startup or corpus data.

### Phase 2: durable corpus ingestion

- Logical artifact/version/discovery/parse/publication state model
- Quota-aware downloads, checksums, and retained raw artifacts
- Streaming lossless parser, action profiles, claim folding, and atomic publication
- Exact 91-member annual first publication from officially enumerated membership
- Retained and observable daily ingestion outside the first-publication policy; later mixed publication requires its own fixture-proven authority policy
- Freshness frontiers, retries, quarantine, durable corpus events, observability, backup, and recovery

Acceptance: corpus-through date is accurate; replay is a no-op; a partial amendment changes only asserted groups; an out-of-order artifact cannot regress canonical state.

### Phase 3: search and text matching

- Discriminated Multi, Split, and Wildcard modes
- Status/type/registration filters within the Class 025 corpus
- Server-side sort/count/offset pagination with corpus-version conflict protection
- Website search, generic reports, inline infinite scroll, and mark detail
- Trigram and exact indexes
- `marks.match-text` and `marks.latest`
- Query-plan, Unicode, span, report-date, and opposition-status tests

Acceptance: search and matching satisfy the canonical contract at production-scale query plans.

### Phase 4: package release and operations

- Publish exact-pinned HTTP client and CLI versions
- Deploy the full corpus and daily reconciliation runtime
- Verify backup/restore, artifact replay, reissue, quarantine, and frontier-recovery runbooks
- Exercise provider-access failure and corpus-unavailable errors

Acceptance: the deployed service rebuilds from retained artifacts, restores account state, reports truthful freshness, and serves the published client/CLI contracts.

## Decisions fixed by this plan

- Thin authenticated website included in v1
- Shared MerchBase Clerk session for browser access; API keys for client and CLI access
- Website self-service API keys with host-side bootstrap and recovery
- Stored, website, API, HTTP-client, and CLI corpus fixed to International Class 025 in v1
- Live, dead, and unknown mark states within that corpus
- Daily batch freshness, not realtime USPTO sync
- Immutable source observations and presence-aware claim folding; no whole-record `status_date` merge
- Partial source authority: annual generation membership is distinct from transaction coverage, and unordered annual/daily claims publish only when their group fold is confluent
- First publication is the exact 91-member annual generation through 2025-12-31; daily evidence remains retained and observable, not superseded
- Public complete frontier distinct from newest published source date
- Private operator diagnostics and database-backed operator roles
- No external realtime subscription in v1
- Dedicated single worker/scheduler in v1
- Private server and website apps; published client and CLI only
- `tt` executable
- `tmturtle.merchbase.co` initial host
- COSS UI, Archivo Variable, light/dark/system appearance, and one chartreuse primary
- Marketing site, standalone `.com`, billing, and alerts remain future product decisions
