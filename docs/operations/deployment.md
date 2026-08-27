---
summary: Defines the supported Mac mini production topology, exact-SHA GitHub deployment, smoke checks, source-worker release boundary, and rollback.
read_when:
  - deploying or diagnosing Trademark Terminal on the Mac mini, Cloudflare Tunnel, production Compose, or restart persistence
  - changing workflows, image revisions, resource limits, production ports, worker startup, or deployment smoke
---

# Deployment

Trademark Terminal runs from `/Users/zknicker/srv/tmterminal` as Compose project
`tmterminal`. Cloudflare Tunnel sends `https://tmterminal.merchbase.co` to loopback
Caddy on port 8095. API diagnostics use loopback port 3095; PostgreSQL uses
loopback 5437 for the established Tailscale development path.

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

Production deployment is the manually dispatched `Deploy Stack` workflow. A
push to `main` never deploys; a deploy is an explicit act now that it resolves
production credentials from 1Password.

**A deploy can only ever ship `main`.** `scripts/deployment-revision` refuses
unless `HEAD` equals both the dispatched SHA and `origin/main`, so dispatching
the workflow against a feature branch is refused by design — land the change
first, then dispatch. The operator dry run (`bun run deploy:dry-run`) needs
Docker plus an identity that reads both lifecycle vaults, so it runs from a
workstation with Docker, not from the mini: the host holds only the
Production-scoped Mac Mini identity and cannot resolve the Development-vault
install credentials.
Quality runs first on a GitHub-hosted runner; the self-hosted Mac mini job runs
only after it passes. The job resets the production checkout to the dispatched
commit and runs `bun run deploy`, which is `scripts/deploy-with-varlock.ts`.

That script:

1. refuses to run if a `.env` exists in the checkout — Varlock loads it above
   the schema, so a leftover file silently overrides the contract;
2. pins `VARLOCK_ENV=production`, and fills the deploy-agent role slot from the
   repository secret (or, for an operator run, re-execs under `op run` with the
   Mac Mini identity);
3. requires `HEAD` to equal both `origin/main` and the workflow SHA;
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
1Password through the committed schema at deploy time and reaches the
containers as environment, never as a generated plaintext file — see
[Environment](environment.md). The deploy script refuses to run if a `.env`
reappears in the checkout.

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
- anonymous data-free readiness;
- source worker heartbeat without claiming source completeness.

The anonymous readiness response is exactly `{"status":"ready"}` and contains
no trademark data. Readiness does not claim source completeness.

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
install credentials, so rebuild from an operator MacBook or re-dispatch
`Deploy Stack` at the target revision.

Do not run a revision against a schema it does not own. Do not delete volumes as
part of rollback. A failed forward-only schema change requires a corrected
revision or an operator-managed database restore; the repository does not own a
backup product in v1.

After recovery, return the host checkout to `main`, fast-forward, and run the
normal exact-SHA deployment.
