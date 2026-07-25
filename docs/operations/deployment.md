---
summary: Defines the supported Mac mini production topology, exact-SHA GitHub deployment, smoke checks, source-worker release boundary, and rollback.
read_when:
  - deploying or diagnosing Trademark Turtle on the Mac mini, Cloudflare Tunnel, production Compose, or restart persistence
  - changing workflows, image revisions, resource limits, production ports, worker startup, or deployment smoke
---

# Deployment

Trademark Turtle runs from `/Users/zknicker/srv/tmturtle` as Compose project
`tmturtle`. Cloudflare Tunnel sends `https://tmturtle.merchbase.co` to loopback
Caddy on port 8095. API diagnostics use loopback port 3095; PostgreSQL uses
loopback 5437 for the established Tailscale development path.

## Topology

| Service | Role |
| --- | --- |
| PostgreSQL 16 | Accounts, source state, live trademark data, and Data Version. |
| migrate | One-shot Drizzle migration before long-running services. |
| API | Fastify/tRPC and data-free readiness. |
| worker | Serial USPTO discovery, download, and application. |
| Caddy/web | Static website and `/api` proxy. |

PostgreSQL and artifact storage use named volumes. No service binds a public host
port. The worker handles one temporary ZIP at a time and keeps the 20 GiB floor
for both persistent filesystems.

## GitHub Deployment

A push to `main` runs the reusable quality workflow on a GitHub-hosted runner.
The self-hosted Mac mini job runs only after quality passes.

The deploy job:

1. fast-forwards the clean production checkout;
2. requires `HEAD` to equal both `origin/main` and the workflow SHA;
3. builds core and web images labeled with that exact revision;
4. stops the existing worker before changing the stack;
5. starts migration, database, API, worker, and web in dependency order;
6. runs `scripts/deployment-smoke`.

The checkout-integrity script refuses tracked, staged, or untracked nonignored
changes. It never cleans or resets the host.

Database, API, worker, and Caddy use restart policies compatible with the
host's Colima launch-on-boot service. Migration remains a successful one-shot
container. Resource limits contain ingestion while leaving PostgreSQL and
authenticated reads independently observable.

## Secrets

The ignored production `.env` lives at
`/Users/zknicker/srv/tmturtle/.env`, mode `0600`. Required values include
database, Clerk, and USPTO credentials. Production authorized parties is exactly
`https://tmturtle.merchbase.co`.

Secrets are not printed, committed, copied into runtime image layers, or exposed
through readiness.

## Bootstrap API Key

Create a host-managed key against the production Compose database with:

```bash
bun run api-keys:create --name merchbase
```

The command runs inside the API container, resolves one stable host account,
writes the raw token once to stdout, and stores only its hash.

## Smoke

`scripts/deployment-smoke` verifies:

- exact image revision labels;
- database, migration, API, worker, and web health;
- at least 20 GiB free in database and artifact volumes;
- bounded loopback and public HTTPS probes;
- anonymous data-free readiness;
- source worker heartbeat without claiming source completeness.

The anonymous readiness response is exactly `{"status":"ready"}` and contains
no trademark data. Readiness does not claim source completeness.

Run it explicitly on the host with:

```bash
cd /Users/zknicker/srv/tmturtle
export TMTURTLE_REVISION="$(git rev-parse HEAD)"
./scripts/deployment-smoke
```

For an ingestion schema cutover, leave the worker stopped until migration,
authenticated reads, existing mark visibility, source-row mapping, and operator
status are verified. Start it only when the deployed revision owns the new
schema.

## Rollback

Code-only rollback uses a known compatible revision while preserving named
volumes:

```bash
git switch --detach <compatible-sha>
export TMTURTLE_REVISION="$(git rev-parse HEAD)"
docker compose --project-name tmturtle --env-file .env build
docker compose --project-name tmturtle --env-file .env up --detach --remove-orphans --wait
./scripts/deployment-smoke
```

Do not run a revision against a schema it does not own. Do not delete volumes as
part of rollback. A failed forward-only schema change requires a corrected
revision or an operator-managed database restore; the repository does not own a
backup product in v1.

After recovery, return the host checkout to `main`, fast-forward, and run the
normal exact-SHA deployment.
