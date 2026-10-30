---
summary: Defines the supported Mac mini production topology, exact-SHA GitHub deployment, smoke checks, source-worker release boundary, and rollback.
read_when:
  - deploying or diagnosing Trademark Terminal on the Mac mini, Cloudflare Tunnel, production Compose, or restart persistence
  - changing workflows, image revisions, resource limits, production ports, worker startup, or deployment smoke
---

# Deployment

Trademark Terminal runs from `/Users/zknicker/srv/tmterminal` as Compose project
`tmterminal`. Cloudflare Tunnel sends the UI host `tmterminal.merchbase.co`, API
host `tmterminal-api.merchbase.co`, and internal receiver host
`tmterminal-internal.merchbase.co` to loopback Caddy on port 8095. API diagnostics use loopback port 3095; PostgreSQL uses
loopback 5437 for host and Tailscale operator access.

## Topology

| Service | Role |
| --- | --- |
| PostgreSQL 16 | Accounts, source state, live trademark data, and Data Version. |
| migrate | One-shot Drizzle migration before long-running services. |
| API | Fastify/tRPC, hosted MCP, OAuth discovery, and data-free readiness. |
| worker | Serial USPTO discovery, download, and application. |
| Caddy/web | Static website and `/docs`, plus exact `/api`, `/mcp`, and OAuth discovery proxies. |

PostgreSQL and artifact storage use named volumes. No service binds a public host
port. The worker handles one temporary ZIP at a time and keeps the 20 GiB floor
for both persistent filesystems.

## GitHub Deployment

Production deployment is GitHub Actions. Every push to `main` runs Quality.
When that run succeeds, `Deploy Stack` deploys that exact commit. The commit
is the identity. `VERSION` is the product version the website shows. It does
not select a deploy. Use the `release-trademark-terminal` skill to bump it.

`workflow_dispatch` takes an optional `ref`, a 40-character SHA on `main`,
for a redeploy or a rollback. An empty ref deploys the current tip.

**A deploy can only ship a commit on `main`.** The resolve job refuses any
other SHA before the production checkout moves. `scripts/deployment-revision`
refuses a dirty checkout, a HEAD that is not the synced commit, or a HEAD
that is not an ancestor of `origin/main`. The deploy script fetches
`origin/main` first. The shared workflow fetches the target SHA and does not
move that remote-tracking ref.

Quality runs on a GitHub-hosted runner. The Mac mini job is the shared
`deploy-service` workflow. It updates `/Users/zknicker/srv/tmterminal` to the
resolved commit and runs `bun run deploy`, which is
`scripts/deploy-with-varlock.ts`.

`bun run check` (fixtures, Compose integration, and workspace builds) does
not run in CI before that job. An operator runs it locally before pushing.

The operator dry run (`bun run deploy:dry-run`) needs Docker plus an identity
that reads both lifecycle vaults, so it runs from a workstation with Docker,
not from the mini: the host holds only the Production-scoped Mac Mini
identity and cannot resolve the Development-vault install credentials.

That script:

1. refuses to run if a `.env` exists in the checkout — Varlock loads it above
   the schema, so a leftover file silently overrides the contract;
2. pins `VARLOCK_ENV=production`, and fills the deploy-agent role slot from the
   repository secret (or, for an operator run, re-execs under `op run` with the
   Mac Mini identity);
3. fetches `origin/main` and requires HEAD to be the synced commit and on
   `main`;
4. requires the centralized-auth cleanup state to be `final`;
5. resolves the two install credentials under the development lifecycle and
   builds core and web images labeled with that exact revision;
6. stops the API and worker, runs the one-shot migration between two
   stable-mapping invariant checks, then restarts the stack;
7. runs `scripts/deployment-smoke` and then `scripts/verify-deployed-secrets.ts`.

The migration window is an intentional authenticated API outage. A failed
invariant check leaves the API and worker stopped for the documented recovery
procedure.

The checkout-integrity script refuses tracked, staged, or untracked nonignored
changes. It never cleans or resets the host.

Database, API, worker, and Caddy use restart policies compatible with the
host's Colima launch-on-boot service. Migration remains a successful one-shot
container. Resource limits contain ingestion while leaving PostgreSQL and
authenticated reads independently observable.

## Secrets

There is no `.env` on the production host. Every value resolves from
1Password through the committed `.env.schema` at deploy time and reaches the
containers as environment, never as a generated plaintext file. The deploy
script refuses to run if a `.env` reappears in the checkout.

`TMTERMINAL_MCP_RESOURCE_URL` is non-secret configuration owned by the schema.
It must remain an absolute HTTP URL with the exact `/mcp` path.

`scripts/verify-deployed-secrets.ts` runs after every deploy and name-diffs
what Docker baked into the containers against the schema's sensitivity split: a
delivered name the schema does not declare is stale, and a production-required
sensitive item missing from the API container is a failure.

Secrets are not printed, committed, copied into runtime image layers, or exposed
through readiness.

The final centralized-auth schema cleanup has a separate approval-gated
dependency, backup, migration, verification, and recovery sequence. Follow
[Access cutover](access-cutover.md); the normal deploy workflow is not authority
to run that destructive cleanup.

## Smoke

`scripts/deployment-smoke` verifies:

- exact image revision labels;
- database, migration, API, worker, and web health;
- at least 20 GiB free in database and artifact volumes;
- bounded loopback and public HTTPS probes;
- anonymous liveness at `https://tmterminal-api.merchbase.co/health/live`.

`GET /health/live` is process liveness. It runs `select 1` and returns
`{"status":"ok","revision":"<value>"}` on HTTP 200. Docker healthchecks, Caddy,
`depends_on`, and deployment smoke use this URL. A supervisor should use it
too. The worker process writes `/tmp/tmterminal-worker-ready` after that same
database query. Stale ingestion does not fail these checks.

`GET /api/health` is the watcher report. Both health bodies include
`revision`. Deployed responses use the 40-character SHA baked from
`TMTERMINAL_REVISION` at image build. `bun run dev` and tests report `dev`.
Workstation compose images report the build arg, `development` or
`development-<project>`. Smoke compares `/health/live` to that same string.
HTTP 200 is `{"status":"ok","revision":"<value>"}`. HTTP 503 is
`{"status":"degraded","failing":[...],"revision":"<value>"}`. The names, in
order, are
`database`, `worker`, and `uspto_data`. `database` means the health read did
not answer within 2 seconds. `worker` fails when the heartbeat is missing or
older than 5 minutes, or the worker is stopped. `uspto_data` fails when the
last successful USPTO update is missing or older than 96 hours. The body has
no trademark rows, error text, or counts, and it does not claim source
completeness. Smoke does not call this URL.

Run it explicitly on the host with:

```bash
cd /Users/zknicker/srv/tmterminal
export TMTERMINAL_REVISION="$(git rev-parse HEAD)"
VARLOCK_ENV=production bunx varlock run -- ./scripts/deployment-smoke
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
export TMTERMINAL_REVISION="$(git rev-parse HEAD)"
export VARLOCK_ENV=production
bunx varlock run -- docker compose --project-name tmterminal build
bunx varlock run -- docker compose --project-name tmterminal up --detach --remove-orphans --wait
bunx varlock run -- ./scripts/deployment-smoke
```

An operator rollback on the mini itself cannot resolve Development-vault
install credentials, so rebuild from an operator MacBook or dispatch
`Deploy Stack` with `ref` set to the target SHA on `main`.

Do not run a revision against a schema it does not own. Do not delete volumes as
part of rollback. A failed forward-only schema change requires a corrected
revision or an operator-managed database restore; the repository does not own a
backup product in v1.

After recovery, return the host checkout to `main`, fast-forward, and run the
normal exact-SHA deployment.
