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

Start the production-shaped local stack and wait for service health:

```bash
bun run compose:up
bun run compose:smoke
```

The startup order is PostgreSQL health, one-shot Drizzle migration, one-shot PRD-60 tracer materialization, API and worker database readiness, then the Caddy website shell. The tracer retains the committed real fixture in the artifact volume and uses the source-observation, canonicalization, and canonical repository modules; it is not a corpus publisher. Its canonical write shares the corpus publication lock and is skipped after a durable corpus publication owns canonical state. `dev-port` allocates four deterministic ports per checkout. The root scripts derive a distinct Compose project name and development image revision from that port, so each worktree owns its containers, network, volumes, and image tags. The website uses the first port and the API uses the second:

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

The worker also requires a rotated `USPTO_API_KEY` associated with an account authorized for ODP. Do not start the live worker with an exposed or retired key. Provider pacing stays configurable without assuming an undocumented quota:

```dotenv
USPTO_DISCOVERY_INTERVAL_MS=21600000
USPTO_SCHEDULER_POLL_MS=10000
USPTO_REQUEST_TIMEOUT_MS=900000
USPTO_RETRY_BASE_MS=30000
USPTO_RETRY_MAX_ATTEMPTS=8
USPTO_RETRY_MAX_MS=21600000
```

Retained downloads live in the dedicated `artifact-data` volume under content-addressed keys. Normal `compose:down` preserves both database and artifact volumes.

Authenticated website use also requires `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES`, and `VITE_CLERK_PUBLISHABLE_KEY`. The Compose wrapper derives `CLERK_AUTHORIZED_PARTIES` from the worktree website port; direct deployments must set the public website origin explicitly. The production-shaped Compose contract refuses to render without all three values; the anonymous API readiness response remains data-free.

Local browser automation uses the shared MerchBase development Clerk instance. Set `DEV_CLERK_SIGN_IN_USER_ID` and `VITE_DEV_CLERK_AUTO_SIGN_IN=true` to opt in. This opt-in is only for an API and Vite server running directly on the host; the production-shaped Compose stack does not forward it or include Vite's development client. With a host-reachable `DATABASE_URL`, start the API and website in separate terminals:

```bash
set -a
. ./.env
set +a
PORT="$(dev-port 1)" bun run --cwd apps/server start
```

```bash
set -a
. ./.env
set +a
TMTURTLE_API_PORT="$(dev-port 1)" bun run --cwd apps/web dev --host 127.0.0.1 --port "$(dev-port 0)"
```

In Vite development only, the website requests a 60-second Clerk sign-in ticket from the local API and then establishes a normal Clerk session. The endpoint requires both an exact `127.0.0.1` Host header and an actual `127.0.0.1` peer; it is absent in production and when the server opt-in is unset. It does not bypass Clerk verification or create a fallback application credential.

Bootstrap or recover a host-managed caller directly against the service database:

```bash
bun run api-keys:create --name merchbase
```

The root command executes inside the running API container for the current Compose project, resolves one stable named host account, writes the raw `ttk_...` token once to stdout, and stores only its SHA-256 secret hash.

Healthy readiness returns only:

```json
{"status":"ready"}
```

When PostgreSQL is unavailable it returns HTTP `503` and `{"status":"unavailable"}`. Readiness is anonymous by design and exposes no corpus data. Every account and mark procedure requires a verified Clerk session or Trademark Turtle API key.

Use the same wrapper for follow-up Compose commands so they reconstruct the checkout's project name and ports:

```bash
bun run compose -- ps
bun run compose -- logs api
```

## Corpus recovery

The authenticated operator page at `/ops/sync` is read-only. It shows current dataset state, bounded logical artifacts, every retained version through a bounded version table, publications, and rejections. Use the full artifact-version UUID shown there for version-specific host commands. Recovery mutations run only inside the current checkout's worker container through the Compose wrapper:

```bash
bun run sync:ops -- quarantine <artifact-version-id> --reason "<operator reason>"
bun run sync:ops -- select-reissue <artifact-version-id> --reason "<selection reason>"
bun run sync:ops -- replay-parser <artifact-version-id>
bun run sync:ops -- recover-source-lane --confirm-all-current-alerts --reason "<recovery reason>"
bun run sync:ops -- recover-frontier
```

`quarantine` accepts only a verified or staged version, preserves the reason and time, and invalidates a selection of that version. `select-reissue` accepts only a parsed, publication-policy-eligible version from a logical artifact with multiple retained versions. `replay-parser` accepts only a version without a run for the current parser. Parser upgrades are completed version by version; publication remains blocked while any logical artifact from the parent publication lacks a current-parser eligible replacement.

`recover-source-lane` locks the lane, requires explicit confirmation, resolves the complete current unresolved USPTO alert set with the supplied reason, and resumes the lane. It refuses a ready lane or a stopped lane with no unresolved alert. `recover-frontier` stages and publishes the currently eligible database-derived source set through the normal corpus publisher. Every command fails closed on a wrong state. There is no automated recovery or command retry loop.

A full rebuild is a distinct offline preflight and wake, not a second ingestion engine:

```bash
bun run sync:rebuild
```

The wrapper stops the current checkout's worker, confirms an empty canonical/publication target with a retained artifact catalog, and wakes the same pg-boss reconciliation queue before restarting the worker. Under the corpus lock, staged or published retained versions that lack a current-parser run are normalized to verified so normal reconciliation can replay them; quarantined evidence is never reset. Completed artifact parses remain durable, so rerunning the command after an interrupted rebuild resumes from database state. The command refuses a non-empty target or an outstanding reconciliation delivery.

Drizzle owns application schema migration. pg-boss owns its separate `pgboss` schema: the one-shot migration entrypoint starts pg-boss with migration enabled after Drizzle, while the production worker starts with `migrate:false` and fails closed if that schema is absent. Repeated migration is expected to be idempotent.

Production deployment, public HTTPS verification, monitoring hooks, and rollback are defined in [Mac mini deployment](deployment.md).

Stop containers while preserving the database volume:

```bash
bun run compose:down
```

For an intentional clean local reset only:

```bash
bun run compose -- down --volumes
```

That reset deletes both the database and retained-artifact volumes. It is never a routine deployment or retry operation.
