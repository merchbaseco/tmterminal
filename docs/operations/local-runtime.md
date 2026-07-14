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

The startup order is PostgreSQL health, one-shot Drizzle migration, API and worker database readiness, then the Caddy website shell. `dev-port` allocates four deterministic ports per checkout. The root scripts also derive a distinct Compose project name, so each worktree owns its containers, network, and volumes. The website uses the first port and the API uses the second:

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

Authenticated website use also requires `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES`, and `VITE_CLERK_PUBLISHABLE_KEY`. The Compose wrapper derives `CLERK_AUTHORIZED_PARTIES` from the worktree website port; direct deployments must set the public website origin explicitly. The API stays ready without Clerk credentials but rejects Clerk sessions; the website intentionally fails fast when its publishable key is absent.

Bootstrap or recover a host-managed caller directly against the service database:

```bash
bun run api-keys:create --name merchbase
```

The root command executes inside the running API container for the current Compose project, resolves one stable named host account, writes the raw `ttk_...` token once to stdout, and stores only its SHA-256 secret hash.

Healthy readiness returns only:

```json
{"status":"ready"}
```

When PostgreSQL is unavailable it returns HTTP `503` and `{"status":"unavailable"}`. Readiness is anonymous by design and exposes no corpus data. The tRPC router contains no data procedures in the runtime spine.

Use the same wrapper for follow-up Compose commands so they reconstruct the checkout's project name and ports:

```bash
bun run compose -- ps
bun run compose -- logs api
```

Stop containers while preserving the database volume:

```bash
bun run compose:down
```

For an intentional clean local reset only:

```bash
bun run compose -- down --volumes
```
