---
summary: Defines local workspace setup, PostgreSQL integration tests, Compose startup, readiness verification, and cleanup.
read_when:
  - starting or diagnosing the Trademark Turtle workspace, PostgreSQL integration harness, migrations, API readiness, worker, Caddy, or Compose services
  - changing root runtime, build, test, migration, health-check, container, port, or local environment commands
---

# Local runtime operations

Trademark Turtle uses Bun 1.3.5 and Docker Compose. Install exact workspace dependencies and run the fast verification lanes from the repository root:

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

Before committing, pass every touched authored path to `bun run lint --`. Pull-request CI runs
`lint:changed` against committed changes from `origin/main`. Use `bun run lint` without paths only
when working down the repository-wide baseline, and pass explicit paths to `bun run lint:fix`; do
not use a broad autofix during feature work.

## PostgreSQL integration tests

The integration lane starts a dedicated PostgreSQL 16 service under a unique Compose project, runs migration and readiness tests against it, and removes its containers, network, and temporary database when the command exits:

```bash
bun run test:integration:compose
```

Set `COMPOSE_PROJECT_NAME` only when a stable diagnostic name is useful. The harness never uses the runtime database volume.

To run the tests against an already isolated PostgreSQL database instead:

```bash
TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/tmturtle_test \
  bun run test:integration
```

The selected database must be disposable. The integration setup removes its Drizzle migration schema and `pg_trgm` extension before testing.

## Runtime stack

Normal product development runs the API and Vite website locally against the production PostgreSQL
trademark data on the Mac mini:

```bash
bun run dev
```

The command uses the current checkout's first two `dev-port` ports, reads the ignored `.env`, and
rewrites only the database host and port in memory to
`zachs-mac-mini.taila0b849.ts.net:5437`. It starts no migration or worker process. The Mac mini must
be reachable over Tailscale. The production `DATABASE_URL` stored in `.env` remains unchanged.

This is live production state. Searches, freshness, reports, and operator diagnostics read the real
data. Account creation and API-key creation or revocation write production state. The command
prints that warning at startup; use the disposable PostgreSQL integration lane for database,
migration, or destructive work.

The production database publishes PostgreSQL only on Mac mini loopback port `5437`. Colima and
Tailscale expose the same house development path used by RankWrangler and EtsySentry; PostgreSQL is
not bound to a public network interface.

For production-shaped runtime and deployment verification, start the isolated Compose stack and
wait for service health:

```bash
bun run compose:up
bun run compose:smoke
```

The startup order is PostgreSQL health, one-shot Drizzle migration, API and worker database readiness, then the Caddy website shell. Runtime images contain no repository fixture payload. `dev-port` allocates four deterministic ports per checkout. The root scripts derive a distinct Compose project name and development image revision from that port, so each worktree owns its containers, network, volumes, and image tags. The website uses the first port and the API uses the second:

```bash
dev-port --group
```

- Website and Caddy proxy: `http://127.0.0.1:<first-port>`
- API readiness: `http://127.0.0.1:<second-port>/api/health`

Override loopback ports without editing Compose:

```bash
TMTURTLE_API_PORT=3300 TMTURTLE_WEB_PORT=8800 bun run compose:up
TMTURTLE_API_PORT=3300 TMTURTLE_WEB_PORT=8800 bun run compose:smoke
```

Direct `docker compose` deployment requires stable `TMTURTLE_API_PORT` and `TMTURTLE_WEB_PORT` values in the environment or `.env`; it never chooses ephemeral production ports.

Set `DATABASE_URL` and `POSTGRES_PASSWORD` in the ignored `.env` before starting Compose. `POSTGRES_DB` and `POSTGRES_USER` default to `tmturtle`; production must replace the example password. The API, worker, and one-shot migration all receive the configured `DATABASE_URL`.

The worker also requires a rotated `USPTO_API_KEY` associated with an account authorized for ODP. Do not start the live worker with an exposed or retired key. Provider timeout and backoff durations remain configurable. The 10-second reconciliation cadence and eight-attempt fail-closed ceiling are private literals and cannot be relaxed through environment configuration:

```dotenv
USPTO_REQUEST_TIMEOUT_MS=900000
USPTO_RETRY_BASE_MS=30000
USPTO_RETRY_MAX_MS=21600000
```

One active download at a time uses the dedicated `artifact-data` volume under a content-addressed key. Projection streams the ZIP entry directly and writes no extracted XML. Success or terminal failure deletes the raw ZIP immediately. Normal `compose:down` preserves the database and any interrupted working object.

Authenticated website use also requires `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES`, and `VITE_CLERK_PUBLISHABLE_KEY`. The Compose wrapper derives `CLERK_AUTHORIZED_PARTIES` from the worktree website port; direct deployments must set the public website origin explicitly. The production-shaped Compose contract refuses to render without all three values; the anonymous API readiness response remains data-free.

Local browser automation uses the shared MerchBase development Clerk instance. Set
`DEV_CLERK_SIGN_IN_USER_ID` and `VITE_DEV_CLERK_AUTO_SIGN_IN=true` to opt in, then use `bun run dev`.
This opt-in is only for an API and Vite server running directly on the host; the production-shaped
Compose stack does not forward it or include Vite's development client.

In Vite development only, the website requests a 60-second Clerk sign-in ticket from the local API and then establishes a normal Clerk session. The endpoint requires both an exact `127.0.0.1` Host header and an actual `127.0.0.1` peer; it is absent in production and when the server opt-in is unset. It does not bypass Clerk verification or create a fallback application credential.
The exact configured development identity also receives read-only operator-page access so local UI
work can inspect the production corpus without changing production role assignments. Production
continues to require the database-backed operator role.

Bootstrap or recover a host-managed caller directly against the service database:

```bash
bun run api-keys:create --name merchbase
```

The root command executes inside the running API container for the current Compose project, resolves one stable named host account, writes the raw `ttk_...` token once to stdout, and stores only its SHA-256 secret hash.

Healthy readiness returns only:

```json
{"status":"ready"}
```

When PostgreSQL is unavailable it returns HTTP `503` and `{"status":"unavailable"}`. Readiness is anonymous by design and exposes no trademark data. Every account and mark procedure requires a verified Clerk session or Trademark Turtle API key.

Use the same wrapper for follow-up Compose commands so they reconstruct the checkout's project name and ports:

```bash
bun run compose -- ps
bun run compose -- logs api
```

## Ingestion operations

The authenticated operator page at `/ops/sync` is read-only. It presents synchronization as continuous work: processed marks and source records, corpus coverage, latest activity, provider health, and bounded source artifacts with state, counts, SHA, coverage, and current error. There are no host mutation commands, queue-progress framing, reprocessing versions, quarantine workflow, compatibility reader, or second rebuild engine.

The worker derives restart work from `source_artifact`. Before source access it removes one unreferenced finalized ZIP, including any object left by a crash before retention was committed. A `downloading` artifact without a committed object becomes terminally failed and is never fetched again. Any failed artifact blocks later downloads. A retained projecting ZIP restarts its rolled-back artifact transaction and replaces only rows still owned by that product and filename. Complete and failed artifacts retain no raw ZIP. Provider backoff/stop state is database-backed and intentionally requires a corrected deployment or explicit database operation designed for the concrete incident; there is no generic recovery command.

The live-data migration preserves the exact deployed annual progress, retained projecting ZIP, projected marks and children, source artifacts, provider lane, accounts, Clerk identities, API keys, and roles while removing generation keys and pointers. Drizzle applies it in one transaction. No compatibility schema or pre-migration cleanup script exists.

Drizzle owns application schema migration. Worker timing is process-local and creates no queue tables. Repeated migration is expected to be idempotent.

Production deployment, public HTTPS verification, monitoring hooks, and rollback are defined in [Mac mini deployment](deployment.md).

Stop containers while preserving the database volume:

```bash
bun run compose:down
```

For an intentional clean local reset only:

```bash
bun run compose -- down --volumes
```

That reset deletes both the database and transient artifact-working volumes. It is never a routine deployment or retry operation.
